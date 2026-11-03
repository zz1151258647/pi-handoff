/** 不联网、不调模型；node tests/simulate.test.js [扩展路径] */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function findPiNodeModules() {
	if (process.env.PI_NODE_MODULES) return process.env.PI_NODE_MODULES;
	const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	try {
		const releases = path.join(agentDir, "install", "releases");
		for (const version of fs.readdirSync(releases).sort().reverse()) {
			const nm = path.join(releases, version, "node_modules");
			if (fs.existsSync(path.join(nm, "jiti"))) return nm;
		}
	} catch { /* 继续寻找 npm 安装。 */ }
	const nm = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@earendil-works", "pi-coding-agent", "node_modules");
	if (fs.existsSync(path.join(nm, "jiti"))) return nm;
	throw new Error("找不到 Pi 运行时；请设置 PI_NODE_MODULES。");
}

const NM = findPiNodeModules();
const piEntry = fs.existsSync(path.join(NM, "@earendil-works", "pi-coding-agent", "dist", "index.js"))
	? path.join(NM, "@earendil-works", "pi-coding-agent", "dist", "index.js")
	: path.join(NM, "..", "dist", "index.js");
const extPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "extensions", "handoff.ts"));
const skillPath = path.join(path.dirname(extPath), "..", "skills", "handoff", "SKILL.md");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ph-manual-test-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(temporary, "agent");
const { createJiti } = require(path.join(NM, "jiti"));

(async () => {
	try {
		const jiti = createJiti(NM + "/", {
			moduleCache: false,
			alias: {
				typebox: NM + "/typebox/build/index.mjs",
				"@earendil-works/pi-coding-agent": piEntry,
				"@earendil-works/pi-tui": NM + "/@earendil-works/pi-tui/dist/index.js",
			},
		});
		const factory = await jiti.import(extPath, { default: true });
		const handlers = {}, commands = {}, tools = {}, renderers = {};
		const userMessages = [], entries = [], notifications = [], markdownTransformers = [];
		let branch = [], sessionId = "session-one", idle = true, dispatchFails = false;
		const project = path.join(temporary, "project-one");
		const secondProject = path.join(temporary, "project-two");
		fs.mkdirSync(project);
		fs.mkdirSync(secondProject);
		const ctx = {
			cwd: project,
			isIdle: () => idle,
			sessionManager: { getSessionId: () => sessionId, getBranch: () => branch },
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		};
		factory({
			on: (name, handler) => { handlers[name] = handler; },
			registerTool: (tool) => { tools[tool.name] = tool; },
			registerCommand: (name, command) => { commands[name] = command; },
			registerEntryRenderer: (name, renderer) => { renderers[name] = renderer; },
			registerMarkdownTransformer: (transformer) => { markdownTransformers.push(transformer); },
			appendEntry: (customType, data) => { const entry = { type: "custom", customType, data }; entries.push(entry); branch.push(entry); },
			sendUserMessage: (text, options) => {
				userMessages.push({ text, options });
				// 模拟真实运行时：异步派发失败时 API 不抛错，也不会触发 before_agent_start。
				if (!dispatchFails) handlers.before_agent_start?.({ messageType: "user", prompt: text }, ctx);
			},
			sendMessage: () => { throw new Error("计数不应发送模型消息"); },
		});
		const command = (args = "") => commands.handoff.handler(args, ctx);
		const save = (content, signal) => tools.handoff_save.execute("t", { content }, signal, undefined, ctx);
		const complete = (signal) => tools.handoff_complete.execute("cleanup", {}, signal, undefined, ctx);
		const bodyOf = (file) => fs.readFileSync(file, "utf8").replace(/^<!-- pi-project-handoff-revision: [^\n]+ -->\r?\n/, "");
		const expectedPath = () => path.join(process.env.PI_CODING_AGENT_DIR, "cache", "project-handoff", "handoff.md");
		const compact = (reason) => {
			const entry = { type: "compaction", id: `c-${entries.length}`, summary: "summary" };
			branch.push(entry); // Pi 在发出事件前已保存 compaction 条目。
			handlers.session_compact({ reason, compactionEntry: entry }, ctx);
		};

		console.log("1. 移除自动化，普通启动和状态查询不创建缓存");
		handlers.session_start({}, ctx);
		assert.equal(handlers.before_agent_start({ messageType: "user", prompt: "普通对话" }, ctx), undefined, "普通回合不注入提示词");
		assert.equal(handlers.agent_before_settle, undefined);
		assert.equal(tools.handoff_state, undefined);
		assert.equal(userMessages.length, 0);
		command("状态"); command("检查");
		assert.equal(userMessages.length, 0);
		assert.match(notifications.at(-1).message, /当前会话已压缩 0 次/);
		assert.equal(fs.existsSync(process.env.PI_CODING_AGENT_DIR), false);
		await assert.rejects(save("unauthorized"), /先执行 \/handoff/);

		console.log("2. 成功压缩计数：threshold、overflow、manual；灰色条目不进入模型");
		for (const reason of ["threshold", "overflow", "manual"]) compact(reason);
		assert.deepEqual(entries.map(e => e.data.count), [1, 2, 3]);
		assert.equal(userMessages.length, 0);
		assert.equal(fs.existsSync(process.env.PI_CODING_AGENT_DIR), false);
		assert.equal(handlers.session_compact_failed, undefined);
		const theme = { fg: (color, text) => { assert.equal(color, "dim"); return text; } };
		const component = renderers.project_handoff_compaction_count(entries.at(-1), {}, theme);
		assert.deepEqual(component.render(80).map(line => line.trimEnd()), ["当前会话已压缩 3 次"]);
		for (const width of [8, 20, 80]) assert.ok(component.render(width).length >= 1);
		handlers.session_start({}, ctx); // reload/resume 从历史读取，不归零、不插入重复提示。
		command("状态");
		assert.match(notifications.at(-1).message, /已压缩 3 次/);
		assert.equal(entries.length, 3);
		branch = branch.slice(0, 2); // 导航回第一次压缩后的分支。
		handlers.session_tree({}, ctx);
		command("状态");
		assert.match(notifications.at(-1).message, /已压缩 1 次/);
		branch = []; sessionId = "session-two";
		handlers.session_start({}, ctx);
		command("状态");
		assert.match(notifications.at(-1).message, /已压缩 0 次/);

		console.log("3. 没有存档、繁忙时不触发模型，也不搜索项目文件");
		fs.writeFileSync(path.join(project, "PROJECT_STATE.md"), "legacy, must not touch");
		command("接续");
		assert.match(notifications.at(-1).message, /没有交接存档/);
		assert.equal(userMessages.length, 0);
		idle = false; command();
		assert.equal(notifications.at(-1).level, "warning");
		assert.equal(userMessages.length, 0);
		idle = true;

		console.log("4. 手动保存到缓存，原子替换、回读、单次授权");
		command("保存 保留未验证事项");
		assert.equal(userMessages.length, 1);
		assert.match(userMessages[0].text, /^\/skill:handoff /);
		assert.match(userMessages[0].text, /保留未验证事项/);
		assert.equal(userMessages[0].options.expandPromptTemplates, true);
		assert.ok(userMessages[0].text.includes(expectedPath()));
		assert.equal(fs.existsSync(expectedPath()), false);
		await assert.rejects(save("  "), /不能为空/);
		const content = "# 任务交接\n目标：完成测试\n下一步：核对成果，未授权发布";
		let result = await save(content);
		const archive = expectedPath();
		const initialArchive = fs.readFileSync(archive, "utf8");
		assert.match(initialArchive, /^<!-- pi-project-handoff-revision: [0-9a-f-]{36} -->\n/);
		assert.ok(initialArchive.includes(result.details.revision));
		assert.equal(result.details.path, archive);
		assert.equal(result.details.verified, true);
		assert.equal(bodyOf(archive), content + "\n");
		assert.deepEqual(fs.readdirSync(path.dirname(archive)), ["handoff.md"]);
		assert.equal(fs.readFileSync(path.join(project, "PROJECT_STATE.md"), "utf8"), "legacy, must not touch");
		assert.deepEqual(fs.readdirSync(project), ["PROJECT_STATE.md"]);
		await assert.rejects(save("second unsolicited write"), /先执行 \/handoff/);

		console.log("5. 新会话自动定位读取，保留附加要求，不自动写回");
		handlers.session_shutdown({}, ctx); sessionId = "session-three";
		handlers.session_start({}, ctx);
		assert.equal(userMessages.length, 1, "新会话启动不自动读取或发送存档");
		command("接续 先跑测试");
		assert.match(userMessages.at(-1).text, /先跑测试/);
		assert.ok(userMessages.at(-1).text.includes(JSON.stringify(initialArchive)));
		assert.ok(userMessages.at(-1).text.includes(archive));
		assert.equal(bodyOf(archive), content + "\n");
		await assert.rejects(save("resume must not write"), /先执行 \/handoff/);
		command("交接 更新进度");
		assert.equal(userMessages.at(-1).text.includes(JSON.stringify(initialArchive)), false, "新保存不混入旧任务材料");
		await save("# 更新后材料");
		assert.equal(bodyOf(archive), "# 更新后材料\n");
		const updatedArchive = fs.readFileSync(archive, "utf8");

		console.log("6. 单份存档跨目录读取并覆盖，授权会话绑定、结束/切换后失效");
		ctx.cwd = secondProject;
		const beforeOther = userMessages.length;
		command("恢复");
		assert.equal(userMessages.length, beforeOther + 1);
		assert.ok(userMessages.at(-1).text.includes(JSON.stringify(updatedArchive)));
		assert.match(userMessages.at(-1).text, /不能将改动误写到当前目录/);
		command(); await save("# 第二项目");
		assert.equal(expectedPath(), archive);
		assert.equal(bodyOf(archive), "# 第二项目\n");
		assert.deepEqual(fs.readdirSync(secondProject), []);
		command(); sessionId = "different-session";
		await assert.rejects(save("wrong session"), /先执行 \/handoff/);
		command(); handlers.agent_settled({}, ctx);
		await assert.rejects(save("stale authorization"), /先执行 \/handoff/);
		command(); handlers.session_tree({}, ctx);
		await assert.rejects(save("stale branch"), /先执行 \/handoff/);

		console.log("7. 并发变更、独占锁、取消不覆盖原档；失败无临时文件泄露");
		command();
		fs.writeFileSync(expectedPath(), "other session updated\n");
		await assert.rejects(save("must not overwrite"), /另一会话更新/);
		assert.equal(fs.readFileSync(expectedPath(), "utf8"), "other session updated\n");
		assert.deepEqual(fs.readdirSync(path.dirname(expectedPath())), ["handoff.md"]);
		command();
		fs.writeFileSync(expectedPath() + ".lock", "");
		await assert.rejects(save("locked"), /EEXIST/);
		fs.unlinkSync(expectedPath() + ".lock");
		const controller = new AbortController(); controller.abort();
		await assert.rejects(save("cancelled", controller.signal), /已取消/);
		assert.equal(fs.readFileSync(expectedPath(), "utf8"), "other session updated\n");
		await save("# retry after cancel");
		assert.deepEqual(fs.readdirSync(path.dirname(expectedPath())), ["handoff.md"]);
		command();
		const concurrent = await Promise.allSettled([save("one"), save("two")]);
		assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
		assert.equal(bodyOf(expectedPath()), "one\n");

		console.log("8. 派发失败不激活授权，后续无关回合不能继承授权");
		dispatchFails = true; command();
		await assert.rejects(save("dispatch never started"), /先执行 \/handoff/);
		handlers.before_agent_start({ messageType: "user", prompt: "后续无关任务" }, ctx);
		await assert.rejects(save("unrelated turn"), /先执行 \/handoff/);
		dispatchFails = false; command();
		const issuedPrompt = userMessages.at(-1).text;
		handlers.agent_settled({}, ctx);
		handlers.before_agent_start({ messageType: "user", prompt: issuedPrompt }, ctx);
		await assert.rejects(save("replay expired request"), /先执行 \/handoff/);

		console.log("9. 接续核对后清理；未核实、取消、并发更新或未授权时保留");
		await assert.rejects(complete(), /先执行 \/handoff 接续/);
		command("接续");
		assert.equal(fs.existsSync(archive), true, "读取不立即删除");
		assert.match(userMessages.at(-1).text, /核对接手成功后调用 handoff_complete/);
		await assert.rejects(complete(controller.signal), /已取消/);
		assert.equal(fs.existsSync(archive), true);
		handlers.agent_settled({}, ctx);
		await assert.rejects(complete(), /先执行 \/handoff 接续/);
		assert.equal(fs.existsSync(archive), true, "核对未完成即结束时保留");
		dispatchFails = true; command("接续");
		await assert.rejects(complete(), /先执行 \/handoff 接续/);
		dispatchFails = false;
		command("接续");
		fs.writeFileSync(archive, "new handoff from other session\n");
		await assert.rejects(complete(), /不会删除新材料/);
		assert.equal(fs.readFileSync(archive, "utf8"), "new handoff from other session\n");

		// 第二个扩展实例模拟另一个真实会话，通过保存工具生成新的唯一修订号。
		const peerHandlers = {}, peerCommands = {}, peerTools = {};
		const peerCtx = { ...ctx, sessionManager: { getSessionId: () => "peer-session", getBranch: () => [] } };
		factory({
			on: (name, handler) => { peerHandlers[name] = handler; },
			registerTool: (tool) => { peerTools[tool.name] = tool; },
			registerCommand: (name, handler) => { peerCommands[name] = handler; },
			registerEntryRenderer: () => {},
			registerMarkdownTransformer: () => {},
			sendUserMessage: (prompt) => peerHandlers.before_agent_start({ messageType: "user", prompt }, peerCtx),
		});
		const peerSave = async (content) => {
			peerCommands.handoff.handler("交接", peerCtx);
			return peerTools.handoff_save.execute("peer", { content }, undefined, undefined, peerCtx);
		};
		await peerSave("# 相同正文");
		command("接续");
		const revisionOne = fs.readFileSync(archive, "utf8");
		await peerSave("# 相同正文");
		const revisionTwo = fs.readFileSync(archive, "utf8");
		assert.notEqual(revisionOne, revisionTwo, "相同正文重写也必须产生新修订号");
		await assert.rejects(complete(), /不会删除新材料/);
		assert.equal(fs.readFileSync(archive, "utf8"), revisionTwo);
		command("接续");
		await peerSave("# 中间内容");
		await peerSave("# 相同正文");
		const revisionThree = fs.readFileSync(archive, "utf8");
		assert.notEqual(revisionTwo, revisionThree, "ABA 内容回退仍是新修订");
		await assert.rejects(complete(), /不会删除新材料/);
		assert.equal(fs.readFileSync(archive, "utf8"), revisionThree);

		command("接续");
		fs.writeFileSync(archive + ".lock", "");
		await assert.rejects(complete(), /EEXIST/);
		fs.unlinkSync(archive + ".lock");
		result = await complete();
		assert.equal(result.details.cleared, true);
		assert.equal(fs.existsSync(archive), false);
		assert.deepEqual(fs.readdirSync(path.dirname(archive)), []);
		await assert.rejects(complete(), /先执行 \/handoff 接续/);
		const afterCleanup = userMessages.length;
		command("接续");
		assert.equal(userMessages.length, afterCleanup, "已消费存档不再次加载");
		command("交接");
		assert.equal(userMessages.at(-1).text.includes("new handoff from other session"), false);
		await assert.rejects(complete(), /先执行 \/handoff 接续/);
		await save("# 从当前会话重新生成");
		assert.equal(bodyOf(archive), "# 从当前会话重新生成\n");

		console.log("10. Skill 仅手动，文档无旧自动触发，缓存权限错误不降级");
		const skill = fs.readFileSync(skillPath, "utf8");
		assert.match(skill, /disable-model-invocation: true/);
		fs.unlinkSync(expectedPath()); fs.mkdirSync(expectedPath());
		const beforeError = userMessages.length;
		command("接续");
		assert.equal(userMessages.length, beforeError);
		assert.equal(notifications.at(-1).level, "error");
		assert.deepEqual(fs.readdirSync(secondProject), []);
		console.log("11. 使用真实 Pi 加载器、SessionManager 与上下文投影验证接口");
		const { pathToFileURL } = require("node:url");
		const host = await import(pathToFileURL(piEntry).href);
		const loader = await import(pathToFileURL(path.join(path.dirname(piEntry), "core", "extensions", "loader.js")).href);
		const loaded = await loader.loadExtensions([extPath], project);
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.extensions.length, 1);
		const extension = loaded.extensions[0];
		assert.ok(extension.commands.has("handoff"));
		assert.ok(extension.tools.has("handoff_save"));
		assert.ok(extension.tools.has("handoff_complete"));
		assert.ok(extension.entryRenderers.has("project_handoff_compaction_count"));
		const manager = host.SessionManager.inMemory(project);
		const userId = manager.appendMessage({ role: "user", content: "测试", timestamp: Date.now() });
		manager.appendCompaction("已压缩", userId, 1000);
		loaded.runtime.appendEntry = (type, data) => manager.appendCustomEntry(type, data);
		const actualCtx = { ...ctx, sessionManager: manager };
		for (const handler of extension.handlers.get("session_compact")) {
			await handler({ type: "session_compact", reason: "manual" }, actualCtx);
		}
		const actualCount = manager.getBranch().at(-1);
		assert.equal(actualCount.type, "custom");
		assert.equal(actualCount.data.count, 1);
		assert.equal(JSON.stringify(manager.buildSessionContext()).includes("project_handoff_compaction_count"), false);

		console.log("12. 两项子命令补全：仅交接/接续、中文前缀、自由补充要求与真实补全提供器");
		const completions = extension.commands.get("handoff").getArgumentCompletions;
		const names = ["交接", "接续"];
		assert.deepEqual(completions("").map(item => item.value), names);
		for (const name of names) {
			assert.deepEqual(completions(name[0]).map(item => item.value), [name]);
			assert.ok(completions(name)[0].description);
		}
		assert.equal(completions("不存在"), null);
		for (const legacy of ["保存", "恢复", "状态", "检查"]) {
			assert.equal(completions(legacy), null, "旧名称仍兼容执行，但不占菜单项");
		}
		for (const input of ["接续 ", "保存 保留未验证事项", "接续 先跑测试", "自定义 补充要求"]) {
			assert.equal(completions(input), null, "不要覆盖用户补充要求");
		}
		const tui = await import(pathToFileURL(path.join(NM, "@earendil-works", "pi-tui", "dist", "index.js")).href);
		const themeModule = await import(pathToFileURL(path.join(path.dirname(piEntry), "modes", "interactive", "theme", "theme.js")).href);
		themeModule.initTheme("dark", false);
		const provider = new tui.CombinedAutocompleteProvider([{ name: "handoff", getArgumentCompletions: completions }], project);
		const signal = new AbortController().signal;
		let suggestions = await provider.getSuggestions(["/handoff "], 0, 9, { signal });
		assert.deepEqual(suggestions.items.map(item => item.value), names);
		assert.equal(provider.applyCompletion(["/handoff "], 0, 9, suggestions.items[1], suggestions.prefix).lines[0], "/handoff 接续");
		suggestions = await provider.getSuggestions(["/handoff 接"], 0, 10, { signal });
		assert.deepEqual(suggestions.items.map(item => item.value), ["接续"]);
		assert.equal(provider.applyCompletion(["/handoff 接"], 0, 10, suggestions.items[0], suggestions.prefix).lines[0], "/handoff 接续");
		const extraInput = "/handoff 接续 先跑测试";
		assert.equal(await provider.getSuggestions([extraInput], 0, extraInput.length, { signal }), null);
		const editor = new tui.Editor({ requestRender() {} }, themeModule.getEditorTheme());
		editor.setAutocompleteProvider(provider);
		for (const char of "/handoff ") {
			editor.handleInput(char);
			await new Promise(setImmediate); // 等待真实编辑器的异步补全派发。
		}
		assert.equal(editor.capturesViewportInput, true, "输入空格后应出现子命令菜单");
		editor.handleInput("\x1b[B"); // 下：交接 -> 接续
		editor.handleInput("\x1b[A"); // 上：接续 -> 交接
		editor.handleInput("\x1b[B"); // 下：交接 -> 接续
		editor.handleInput("\t");
		assert.equal(editor.getText(), "/handoff 接续", "上下键选择，Tab 填入而不发送");

		console.log("13. 长接续仅缩短界面显示，模型仍收到完整原文和授权；普通消息不受影响");
		assert.equal(typeof extension.markdownTransformer, "function");
		assert.equal(markdownTransformers.length, 1);
		const transform = extension.markdownTransformer;
		fs.rmdirSync(archive); // 上面的权限错误用目录代替存档；恢复为长测试材料。
		const longArchive = "# 长交接材料\n" + "关键背景、证据与未授权边界\n".repeat(500);
		fs.writeFileSync(archive, longArchive);
		command("接续 先核对不要发布");
		const longPrompt = userMessages.at(-1).text;
		const visibleBody = longPrompt.replace(/^\/skill:handoff /, "");
		const brief = "/handoff 接续（已加载交接材料，正文不展开；待核对接手）";
		assert.equal(transform(longPrompt, { messageType: "user" }), brief);
		assert.equal(transform(visibleBody, { messageType: "user" }), brief, "Skill 展开后的参数正文也应缩短");
		assert.ok(longPrompt.includes(JSON.stringify(longArchive)));
		assert.match(longPrompt, /先核对不要发布/);
		assert.equal(transform(longPrompt, { messageType: "assistant" }), longPrompt);
		assert.equal(transform(longPrompt, { messageType: "assistant-thinking" }), longPrompt);
		for (const text of [
			"请修复 /handoff 接续",
			"接续。工作目录：普通用户说明",
			"交接授权标识：not-a-request",
			"保存当前进度。工作目录：这是故障报告示例\n交接授权标识：12345678-1234-4234-8234-123456789abc",
			"接续。工作目录：这是故障报告示例\n交接授权标识：12345678-1234-4234-8234-123456789abc\n\n交接材料（JSON 字符串）：\n\"示例\"",
			visibleBody.replace(/交接授权标识：[0-9a-f-]{36}/, "交接授权标识：" + "-".repeat(36)),
			visibleBody.replace(/交接授权标识：[0-9a-f-]{36}/, "无标识"),
		]) {
			assert.equal(transform(text, { messageType: "user" }), text, "不要改普通用户消息");
		}
		const display = await import(pathToFileURL(path.join(path.dirname(piEntry), "modes", "interactive", "components", "user-message.js")).href);
		const userComponent = new display.UserMessageComponent(visibleBody, undefined, 1, [transform]);
		for (const width of [30, 60, 120]) {
			const lines = userComponent.render(width);
			assert.ok(lines.length <= 8, `宽度 ${width} 时不应铺满会话：${lines.length} 行`);
			assert.equal(lines.join("\n").includes("关键背景"), false);
		}
		const contextManager = host.SessionManager.inMemory(project);
		contextManager.appendMessage({ role: "user", content: longPrompt, timestamp: Date.now() });
		assert.ok(contextManager.buildSessionContext().messages.some(message => message.content === longPrompt));
		result = await complete(); // 显示缩短不破坏原来的授权激活和清理流程。
		assert.equal(result.details.cleared, true);
		command("保存 保留未验证事项");
		assert.match(transform(userMessages.at(-1).text, { messageType: "user" }), /^\/handoff 交接（/);
		await save("# 界面修复后仍可保存");

		console.log("14. 完整按键：命令名 Tab 后立即打开两项菜单；选择不提交、Esc 取消、额外 Tab 重开");
		const { KeybindingsManager } = await import(pathToFileURL(path.join(path.dirname(piEntry), "core", "keybindings.js")).href);
		const kb = new KeybindingsManager();
		const fakeTui = { requestRender() {}, terminal: { rows: 30, columns: 100 } };
		const typeText = async (target, text) => {
			for (const char of text) {
				target.handleInput(char);
				await new Promise(setImmediate);
			}
		};
		const createUI = async (previousFactory, baseProvider = provider) => {
			let activeProvider = baseProvider, editorFactory = previousFactory, activeEditor;
			const submitted = [];
			const ui = {
				...ctx.ui,
				addAutocompleteProvider: wrap => { activeProvider = wrap(activeProvider); },
				getEditorComponent: () => editorFactory,
				setEditorComponent: next => {
					editorFactory = next;
					activeEditor = next(fakeTui, themeModule.getEditorTheme(), kb);
					activeEditor.setAutocompleteProvider(activeProvider);
					activeEditor.onSubmit = text => submitted.push(text);
				},
			};
			for (const handler of extension.handlers.get("session_start")) {
				await handler({ type: "session_start", reason: "startup" }, { ...actualCtx, mode: "tui", ui });
			}
			return { editor: activeEditor, provider: activeProvider, submitted };
		};
		const beforeKeyboardTests = userMessages.length;
		for (const prefix of ["/handoff", "/hand"]) {
			const testUI = await createUI();
			await typeText(testUI.editor, prefix);
			testUI.editor.handleInput("\t");
			await new Promise(setImmediate);
			assert.equal(testUI.editor.getText(), "/handoff ");
			assert.equal(testUI.editor.capturesViewportInput, true, `${prefix} Tab 后必须直接弹出子菜单`);
			const actual = await testUI.provider.getSuggestions(["/handoff "], 0, 9, { signal, force: true });
			assert.deepEqual(actual.items.map(item => item.value), names);
			const rendered = testUI.editor.render(100).join("\n");
			assert.ok(rendered.includes("交接") && rendered.includes("接续"));
			assert.equal(rendered.includes("状态"), false);
			testUI.editor.handleInput("\x1b[B");
			testUI.editor.handleInput("\x1b[A");
			testUI.editor.handleInput("\x1b[B");
			testUI.editor.handleInput("\t");
			assert.equal(testUI.editor.getText(), "/handoff 接续");
			assert.deepEqual(testUI.submitted, [], "选择参数不可直接执行命令");
			await typeText(testUI.editor, " 先核对不要发布");
			assert.equal(testUI.editor.getText(), "/handoff 接续 先核对不要发布");
			testUI.editor.handleInput("\r");
			assert.deepEqual(testUI.submitted, ["/handoff 接续 先核对不要发布"]);
		}
		const escapeUI = await createUI();
		await typeText(escapeUI.editor, "/handoff");
		escapeUI.editor.handleInput("\t");
		await new Promise(setImmediate);
		escapeUI.editor.handleInput("\x1b");
		assert.equal(escapeUI.editor.capturesViewportInput, false);
		assert.equal(escapeUI.editor.getText(), "/handoff ");
		escapeUI.editor.handleInput("\t");
		await new Promise(setImmediate);
		assert.equal(escapeUI.editor.capturesViewportInput, true, "空格后的显式 Tab 应重开子菜单，而非文件菜单");
		escapeUI.editor.handleInput("\r");
		assert.equal(escapeUI.editor.getText(), "/handoff 交接");
		assert.deepEqual(escapeUI.submitted, [], "Enter 选择参数后不自动发送");
		escapeUI.editor.handleInput("\r");
		assert.deepEqual(escapeUI.submitted, ["/handoff 交接"]);
		assert.equal(userMessages.length, beforeKeyboardTests, "菜单操作不应唤起模型");

		console.log("15. 组合既有编辑器；其他命令、@与路径补全原样委托；非TUI不安装包装");
		let previousEditor;
		const previousFactory = (tui, theme, bindings) => {
			previousEditor = new host.CustomEditor(tui, theme, bindings);
			return previousEditor;
		};
		const combinedUI = await createUI(previousFactory);
		assert.equal(combinedUI.editor, previousEditor, "不能丢弃其他扩展已有的编辑器实例");
		await typeText(combinedUI.editor, "/hand");
		combinedUI.editor.handleInput("\t");
		await new Promise(setImmediate);
		assert.equal(combinedUI.editor.capturesViewportInput, true);
		combinedUI.editor.handleInput("\x1b");
		const delegated = [];
		const sentinel = {
			triggerCharacters: ["$"],
			getSuggestions: (...args) => { delegated.push(["suggest", args]); return null; },
			applyCompletion: (...args) => { delegated.push(["apply", args]); return "unchanged"; },
			shouldTriggerFileCompletion: (...args) => { delegated.push(["file", args]); return false; },
		};
		const delegatedUI = await createUI(undefined, sentinel);
		assert.deepEqual(delegatedUI.provider.triggerCharacters, ["$"]);
		for (const input of ["/other ", "@file", "./path", "/handoff 接续 附加要求"]) {
			const options = { signal, force: true };
			await delegatedUI.provider.getSuggestions([input], 0, input.length, options);
			assert.equal(delegated.at(-1)[1][3], options, "非 handoff 子菜单不可改 force 或其他选项");
			assert.equal(delegatedUI.provider.shouldTriggerFileCompletion([input], 0, input.length), false);
		}
		const applyArgs = [["@file"], 0, 5, { value: "@file.txt", label: "@file.txt" }, "@file"];
		assert.equal(delegatedUI.provider.applyCompletion(...applyArgs), "unchanged");
		assert.deepEqual(delegated.at(-1), ["apply", applyArgs]);
		for (const handler of extension.handlers.get("session_start")) {
			await handler({ type: "session_start" }, { ...actualCtx, mode: "rpc", ui: { notify() {} } });
		}
		console.log("\n全部通过");
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
