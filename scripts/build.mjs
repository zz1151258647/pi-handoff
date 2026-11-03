import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isInside, rejectSymlinkPath, RUNTIME_FILES } from "./install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out-dir" || !args[1])) {
	throw new Error("用法：npm run build -- [--out-dir <输出目录>]");
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error("构建需要 Node.js >=22.13（stripTypeScriptTypes）");
const out = resolve(args[1] || join(root, "dist"));
if (isInside(root, out) && !isInside(join(root, "dist"), out)) {
	throw new Error("源码内输出仅允许 dist/；也可指定源码外的输出目录");
}
if (isInside(out, root)) throw new Error("输出目录不能包含源码目录");
rejectSymlinkPath(out);

function listFiles(directory, prefix = "") {
	return readdirSync(directory).flatMap(name => {
		const rel = prefix ? `${prefix}/${name}` : name;
		const full = join(directory, name);
		const stat = lstatSync(full);
		if (stat.isSymbolicLink()) throw new Error(`拒绝打包符号链接：${rel}`);
		if (stat.isDirectory()) return listFiles(full, rel);
		if (!stat.isFile()) throw new Error(`拒绝非普通文件：${rel}`);
		return [rel];
	}).sort();
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.name !== "pi-handoff" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("无效的运行包名称或版本");
const skills = listFiles(join(root, "skills", "handoff"), "skills/handoff");
if (JSON.stringify(skills) !== JSON.stringify(RUNTIME_FILES.filter(file => file.startsWith("skills/")).sort())) {
	throw new Error("Skill 资源与发布白名单不一致，请显式更新 RUNTIME_FILES");
}
const temporary = mkdtempSync(join(tmpdir(), "pi-handoff-build-"));
try {
	const staging = join(temporary, "package");
	mkdirSync(staging);
	for (const file of RUNTIME_FILES) {
		if (file === "package.json") continue;
		const source = join(root, file === "install.mjs" ? "scripts/install.mjs" : file === "extensions/handoff.js" ? "extensions/handoff.ts" : file);
		rejectSymlinkPath(source);
		if (!lstatSync(source).isFile()) throw new Error(`缺少构建输入：${file}`);
		const target = join(staging, file);
		mkdirSync(dirname(target), { recursive: true });
		if (file === "extensions/handoff.js") {
			// 仅擦除类型；保留宿主导入，不打包 SDK/typebox，不改变扩展业务。
			writeFileSync(target, stripTypeScriptTypes(readFileSync(source, "utf8"), { mode: "strip" }));
		} else copyFileSync(source, target);
	}
	const runtime = {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		keywords: manifest.keywords,
		license: manifest.license,
		type: "module",
		engines: manifest.engines,
		files: [...RUNTIME_FILES],
		pi: { extensions: ["./extensions/handoff.js"], skills: ["./skills/handoff"] },
		peerDependencies: manifest.peerDependencies,
	};
	writeFileSync(join(staging, "package.json"), JSON.stringify(runtime, null, 2) + "\n");
	// npm run 提供本机 npm CLI 路径；不执行 install、不解析远端包、不运行生命周期。
	const npm = process.env.npm_execpath;
	if (!npm || !existsSync(npm)) throw new Error("请通过 npm run build 执行，以使用本机 npm CLI（无需联网）");
	const packed = spawnSync(process.execPath, [npm, "pack", "--offline", "--ignore-scripts", "--json", "--workspaces=false", "--pack-destination", temporary], {
		cwd: staging,
		encoding: "utf8",
		env: { ...process.env, npm_config_cache: join(temporary, "npm-cache"), npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false" },
	});
	if (packed.error || packed.status !== 0) throw new Error(`npm pack 失败：${packed.error?.message || packed.stderr}`);
	const [info] = JSON.parse(packed.stdout);
	if (JSON.stringify(info.files.map(file => file.path).sort()) !== JSON.stringify([...RUNTIME_FILES].sort())) {
		throw new Error("npm pack 文件清单不符合严格白名单");
	}
	const filename = `pi-handoff-${manifest.version}.tgz`;
	if (info.filename !== filename) throw new Error("npm pack 产物名称不符");
	const archive = readFileSync(join(temporary, filename));
	const sums = `${createHash("sha256").update(archive).digest("hex")}  ${filename}\n`;
	mkdirSync(out, { recursive: true });
	for (const name of [filename, "SHA256SUMS.txt"]) {
		rejectSymlinkPath(join(out, name));
		if (existsSync(join(out, name)) && !lstatSync(join(out, name)).isFile()) throw new Error(`输出不是普通文件：${name}`);
	}
	writeFileSync(join(out, filename), archive);
	writeFileSync(join(out, "SHA256SUMS.txt"), sums);
	console.log(`已生成 ${join(out, filename)}（${info.files.length} 个白名单文件）`);
	console.log(sums.trim());
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
