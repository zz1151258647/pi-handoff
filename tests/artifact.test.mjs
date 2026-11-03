// 离线验收：只使用临时包/缓存，不读取用户交接材料或修改 Pi 设置。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 独立于构建脚本的验收名单，防止实现与测试共享错误。
const expected = [
	"LICENSE", "README.md", "extensions/handoff.js", "install.mjs", "package.json",
	"skills/handoff/SKILL.md", "skills/handoff/assets/PROJECT_STATE.template.md",
	"skills/handoff/references/counter.md", "skills/handoff/references/handoff.md",
].sort();
const hash = value => createHash("sha256").update(value).digest("hex");
function files(directory, prefix = "") {
	return readdirSync(directory).flatMap(name => {
		const rel = prefix ? `${prefix}/${name}` : name;
		const stat = lstatSync(join(directory, name));
		assert.equal(stat.isSymbolicLink(), false, `不允许符号链接：${rel}`);
		if (stat.isDirectory()) return files(join(directory, name), rel);
		assert.ok(stat.isFile());
		return [rel];
	}).sort();
}
function snapshot() {
	const result = {};
	for (const name of ["extensions", "skills", "scripts", "tests"]) {
		for (const file of files(join(root, name), name)) result[file] = hash(readFileSync(join(root, file)));
	}
	for (const name of ["package.json", "README.md", "LICENSE", ".gitignore"]) result[name] = hash(readFileSync(join(root, name)));
	// 只检查存在性，不读取用户可能保留的 lock 或 node_modules。
	result.lockExists = existsSync(join(root, "package-lock.json"));
	result.nodeModulesExists = existsSync(join(root, "node_modules"));
	return result;
}
function run(script, args = [], { fail = false, cwd = root, discoverHost = false } = {}) {
	// simulate 在定位宿主依赖后自行切换临时 agent；不可提前遮蔽独立安装的 releases 路径。
	const env = discoverHost ? process.env : { ...process.env, PI_CODING_AGENT_DIR: join(temporary, "agent") };
	const result = spawnSync(process.execPath, [script, ...args], {
		cwd, encoding: "utf8", env,
	});
	assert.ifError(result.error);
	if (fail) assert.notEqual(result.status, 0, result.stdout);
	else assert.equal(result.status, 0, result.stdout + result.stderr);
	return result;
}

// 仅接受本构建所需的普通 USTAR 文件；在写入前检查所有头、重复与路径。
// 不调用 npm install，也不让解包工具处理符号链接或路径穿越。
function unpack(archive, destination) {
	const tar = gunzipSync(archive);
	const entries = new Map();
	const text = buffer => buffer.toString("utf8").replace(/\0.*$/s, "");
	let offset = 0, ended = false;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) {
			assert.ok(tar.subarray(offset).every(byte => byte === 0), "tar 结束标记后不得夹带数据");
			ended = true;
			break;
		}
		const checksum = parseInt(text(header.subarray(148, 156)).trim(), 8);
		const actual = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
		assert.equal(checksum, actual, "tar 头校验和");
		assert.ok(header[156] === 0 || header[156] === 48, "tar 仅允许普通文件，不允许链接/额外元数据");
		assert.equal(text(header.subarray(345, 500)), "", "不允许隐藏路径前缀");
		const name = text(header.subarray(0, 100));
		assert.ok(name.startsWith("package/"));
		const file = name.slice(8);
		assert.ok(expected.includes(file), `非白名单文件：${file}`);
		assert.equal(entries.has(file), false, `重复文件：${file}`);
		const size = parseInt(text(header.subarray(124, 136)).trim(), 8);
		assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
		entries.set(file, tar.subarray(offset + 512, offset + 512 + size));
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	assert.equal(ended, true, "tar 必须包含完整结束标记");
	assert.deepEqual([...entries.keys()].sort(), expected);
	for (const [file, data] of entries) {
		const target = join(destination, file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, data, { flag: "wx" });
	}
}

const temporary = mkdtempSync(join(tmpdir(), "pi-handoff-artifact-"));
const before = snapshot();
try {
	console.log("A. 临时离线构建、SHA256、tar 头与独立逐文件白名单");
	const out = join(temporary, "output with spaces");
	const build = run(join(root, "scripts/build.mjs"), ["--out-dir", out]);
	console.log(build.stdout.trim());
	const sourceManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	assert.equal(sourceManifest.version, "2.0.1");
	assert.deepEqual(sourceManifest.pi.extensions, ["./extensions/handoff.ts"]);
	const filename = `pi-handoff-${sourceManifest.version}.tgz`;
	assert.deepEqual(readdirSync(out).sort(), ["SHA256SUMS.txt", filename].sort());
	const archive = readFileSync(join(out, filename));
	assert.equal(readFileSync(join(out, "SHA256SUMS.txt"), "utf8"), `${hash(archive)}  ${filename}\n`);
	const extracted = join(temporary, "extracted");
	unpack(archive, extracted);
	assert.deepEqual(files(extracted), expected);
	const tainted = gzipSync(Buffer.concat([gunzipSync(archive), Buffer.from("unexpected trailing data")]));
	const rejected = join(temporary, "rejected-trailing-data");
	assert.throws(() => unpack(tainted, rejected), /结束标记后不得夹带数据/);
	assert.equal(existsSync(rejected), false, "发现归档尾部夹带时不得写出文件");

	console.log("B. ESM 运行 manifest、宿主 peers、不含构建依赖/生命周期/开发材料");
	const manifest = JSON.parse(readFileSync(join(extracted, "package.json"), "utf8"));
	assert.equal(manifest.name, "pi-handoff");
	assert.equal(manifest.version, sourceManifest.version);
	assert.equal(manifest.type, "module");
	assert.deepEqual(manifest.pi, { extensions: ["./extensions/handoff.js"], skills: ["./skills/handoff"] });
	assert.deepEqual(manifest.peerDependencies, sourceManifest.peerDependencies);
	assert.ok(Object.values(manifest.peerDependencies).every(range => range === "*"));
	assert.equal(manifest.engines.node, ">=22.13.0");
	assert.deepEqual([...manifest.files].sort(), expected);
	for (const field of ["dependencies", "devDependencies", "scripts", "bundledDependencies"]) assert.equal(manifest[field], undefined);
	const js = readFileSync(join(extracted, "extensions/handoff.js"), "utf8");
	for (const name of ["typebox", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) assert.ok(js.includes(`from "${name}"`));
	run("--check", [join(extracted, "extensions/handoff.js")]);

	console.log("C. 真正验收包内全部 Skill 资源、相对链接与原始内容");
	const skillFiles = expected.filter(file => file.startsWith("skills/"));
	assert.deepEqual(files(join(root, "skills/handoff"), "skills/handoff"), skillFiles);
	for (const file of [...skillFiles, "README.md", "LICENSE"]) {
		assert.deepEqual(readFileSync(join(extracted, file)), readFileSync(join(root, file)), `复制内容一致：${file}`);
	}
	for (const file of skillFiles) {
		const markdown = readFileSync(join(extracted, file), "utf8");
		for (const [, target] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
			if (/^(?:https?:|#)/.test(target)) continue;
			const linked = resolve(dirname(join(extracted, file)), target.split("#")[0]);
			assert.ok(existsSync(linked), `包内 Skill 链接可用：${file} -> ${target}`);
		}
	}

	console.log("D. 源码15组回归；产物JS15组回归（含真实Pi loader/编辑器/上下文）");
	for (const entry of [join(root, "extensions/handoff.ts"), join(extracted, "extensions/handoff.js")]) {
		const simulation = run(join(root, "tests/simulate.test.js"), [entry], { discoverHost: true });
		console.log(`${entry.endsWith(".ts") ? "源码" : "产物"}：${simulation.stdout.trim()}`);
	}

	console.log("E. 从其他工作目录安装到空目录；无配置副作用、拒绝非空/重叠/符号链接");
	const installer = join(extracted, "install.mjs");
	const installed = join(temporary, "versions", "2.0.1");
	const extractedBefore = Object.fromEntries(files(extracted).map(file => [file, hash(readFileSync(join(extracted, file)))]));
	run(installer, ["--dest", installed], { cwd: tmpdir() });
	assert.deepEqual(files(installed), expected);
	for (const file of expected) assert.equal(hash(readFileSync(join(installed, file))), extractedBefore[file]);
	const existingEmpty = join(temporary, "existing-empty");
	mkdirSync(existingEmpty);
	run(installer, ["--dest", existingEmpty]);
	const nonempty = join(temporary, "occupied");
	mkdirSync(nonempty);
	writeFileSync(join(nonempty, "settings.json"), "must not change");
	assert.match(run(installer, ["--dest", nonempty], { fail: true }).stderr, /空目录/);
	assert.deepEqual(files(nonempty), ["settings.json"]);
	assert.equal(readFileSync(join(nonempty, "settings.json"), "utf8"), "must not change");
	assert.match(run(installer, ["--dest", installed], { fail: true }).stderr, /空目录/);
	assert.match(run(installer, ["--dest", join(extracted, "nested")], { fail: true }).stderr, /重叠/);
	assert.equal(existsSync(join(extracted, "nested")), false);
	assert.match(run(installer, ["--dest", join(extracted, "..nested")], { fail: true }).stderr, /重叠/);
	assert.equal(existsSync(join(extracted, "..nested")), false);
	assert.match(run(installer, [], { fail: true }).stderr, /用法/);
	const link = join(temporary, "linked");
	// Windows 目录联接无需管理员权限；POSIX 使用目录符号链接。
	symlinkSync(existingEmpty, link, process.platform === "win32" ? "junction" : "dir");
	assert.match(run(installer, ["--dest", join(link, "new-version")], { fail: true }).stderr, /符号链接/);
	assert.equal(existsSync(join(existingEmpty, "new-version")), false);
	assert.match(run(join(root, "scripts/build.mjs"), ["--out-dir", root], { fail: true }).stderr, /源码/);
	assert.match(run(join(root, "scripts/build.mjs"), ["--out-dir", join(root, "..nested")], { fail: true }).stderr, /源码/);
	assert.equal(existsSync(join(root, "..nested")), false);
	assert.match(run(join(root, "scripts/build.mjs"), ["--out-dir", join(link, "output")], { fail: true }).stderr, /符号链接/);
	assert.deepEqual(Object.fromEntries(files(extracted).map(file => [file, hash(readFileSync(join(extracted, file)))])), extractedBefore);
	assert.equal(existsSync(join(temporary, "agent")), false, "测试/安装不能写入外层 Pi 设置或缓存");
	assert.deepEqual(snapshot(), before, "构建、解包、安装和回归均未改变源码或产生 lock/node_modules");
	console.log("\n产物全部验收通过（9文件、源码15组 + 产物15组、安全安装保护）。");
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
