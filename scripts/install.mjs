import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 发布和安装共用逐文件白名单；Skill 新增资源时必须显式更新并验收。
export const RUNTIME_FILES = Object.freeze([
	"extensions/handoff.js",
	"skills/handoff/SKILL.md",
	"skills/handoff/assets/PROJECT_STATE.template.md",
	"skills/handoff/references/counter.md",
	"skills/handoff/references/handoff.md",
	"package.json",
	"README.md",
	"LICENSE",
	"install.mjs",
]);

export function isInside(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// 不沿符号链接/目录联接写入其他位置；也检查尚未创建路径的现存祖先。
export function rejectSymlinkPath(file) {
	for (let current = resolve(file); ; current = dirname(current)) {
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error(`拒绝符号链接路径：${current}`);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (dirname(current) === current) break;
	}
}

export function install(source, destination) {
	source = resolve(source);
	destination = resolve(destination);
	if (isInside(source, destination) || isInside(destination, source)) {
		throw new Error("安装目标不能与运行包目录重叠");
	}
	rejectSymlinkPath(destination);
	try {
		if (!lstatSync(destination).isDirectory() || readdirSync(destination).length) {
			throw new Error("安装目标必须是空目录；不会覆盖现有文件");
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	// 先完整校验来源，避免在源码包上误运行安装器时创建不完整安装。
	for (const file of RUNTIME_FILES) {
		const full = join(source, file);
		rejectSymlinkPath(full);
		if (!lstatSync(full).isFile()) throw new Error(`缺少运行文件：${file}`);
	}
	const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	if (manifest.type !== "module" || manifest.pi?.extensions?.join() !== "./extensions/handoff.js"
		|| manifest.pi?.skills?.join() !== "./skills/handoff") {
		throw new Error("安装来源不是预编译 pi-handoff 运行包");
	}
	mkdirSync(destination, { recursive: true });
	for (const file of RUNTIME_FILES) {
		const target = join(destination, file);
		rejectSymlinkPath(target);
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(join(source, file), target, constants.COPYFILE_EXCL);
	}
	console.log(`已复制运行包到 ${destination}；未修改 Pi 设置或缓存。请手动加载该固定目录。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const args = process.argv.slice(2);
		if (args.length !== 2 || args[0] !== "--dest" || !args[1]) {
			throw new Error("用法：node install.mjs --dest <空版本目录>");
		}
		install(dirname(fileURLToPath(import.meta.url)), args[1]);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
