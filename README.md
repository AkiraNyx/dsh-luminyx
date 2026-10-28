# Luminyx · 通用人格设定

> `dsh-luminyx` —— 名字取自 *lumen*（光）与 **Nyx**（夜）：白天的光与夜里的光，
> 都是光。人格设定要做的也正是这件事 —— 给模型一个既能照亮、也能沉下来的面孔。

给 DeepSeek Harness 用的通用人格设定插件。一份人格包 = 一个目录里的几个纯文本文件；
装上就能用，改文件即生效，不重启、不改任何 `@deepseek-ai` 包。

- **注入**：人格正文 / 常驻事实注册为系统提示段 `persona:main`、`persona:facts`
- **工具**：`persona_status` / `persona_packs` / `persona_recall` / `persona_remember` / `persona_forget` / `persona_lore`
- **界面**：设置 → 人格设定（包切换、正文编辑、记忆管理、注入参数）
- **文件**：全部落在 `~/.dsh/persona/`，纯文本、可 diff、可备份
  （数据目录沿用 `persona` 这个通用名，和插件品牌名解耦 —— 以后插件叫什么都动不到你已有的人格与记忆）

---

## 一、安装

DSH 的插件挂在 profile 上，两步：把目录放到 `~/.dsh/plugins/`，再让 profile 知道它。

```bash
# 1) 放进插件目录
cp -r . ~/.dsh/plugins/dsh-luminyx
```

```jsonc
// 2) ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-luminyx": "file:../../plugins/dsh-luminyx"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-luminyx"]
    }
  }
}
```

```bash
# 3) 在 profile 目录装依赖，然后重启 dsh
cd ~/.dsh/profiles/<profile> && <你的包管理器> install
```

重启后设置页出现「人格设定」，并且：

```bash
curl http://127.0.0.1:9172/persona/api/overview
```

返回 JSON 即为挂载成功。宿主半的改动需要重启；**改人格文件不需要**。

自检：

```bash
cd ~/.dsh/plugins/dsh-luminyx && npm test
```

---

## 二、三分钟上手

1. 打开 **设置 → 人格设定**。
2. 「新建」一个人格包：`id`（目录名，小写字母/数字/`-`/`_`）、显示名称、默认称呼。
3. 「人格正文」页签里写这个人格是谁。写完按 **⌘S / Ctrl+S**，下一轮对话就生效。
4. 「长期记忆」页签里手填几条事实，或者直接跟模型说「记住……」，它自己会调 `persona_remember`。

内置包 `example` 是一份可直接照抄的模板，改它会自动 fork 到你的用户目录，不动原文件。

---

## 三、人格包结构

```
~/.dsh/persona/
├── active.json              { "id": "当前激活的包" }
├── settings.json            注入开关、段 order、长度上限、召回参数
└── packs/
    └── <id>/
        ├── pack.json        id / name / address / description / version / tags
        ├── persona.md       → 系统提示段 persona:main
        ├── facts.md         → 系统提示段 persona:facts
        ├── lore.jsonl       档案，一行一条 {id, chapter, title, text, tags}
        └── memory.jsonl     长期记忆，运行期写入
```

四个文件怎么分工：

| 文件 | 是什么 | 注入方式 | 写什么 |
|---|---|---|---|
| `persona.md` | 人格本体 | 每轮全文注入 | 身份、语气、工作方式、相处、边界 |
| `facts.md` | 常驻事实 | 每轮全文注入 | 称呼、约定、忌讳、稳定偏好（短句） |
| `lore.jsonl` | 设定档案 | 不注入，按需检索 | 章节化长文：世界观、往事、细节设定 |
| `memory.jsonl` | 长期记忆 | 不注入，按需检索 | 对话中沉淀下来的事实 |

一句话：**每次都用的写进 md，可能用到的写进 jsonl。**

### 分块写法

`persona.md` 用 `## ` 分模块。第一个 `## ` 之前的内容算文件头（说明文字，一起注入），
之后每个 `## 标题` 是一个模块，模块里的行按前缀决定写法：

```markdown
# 示例人格｜人格设定      ← 文件头：说明文字

> 这一段作为系统提示注入。

## 身份                     ← 一个模块 = 一个 `## `
- 我是「示例人格」。        ← `- ` 列表项
跟用户长期协作的搭档。       ← 无前缀 = 普通段落行
> 「先给结论，再给依据。」    ← `> ` 引用（台词、示例）
```

设置页把每个 `## ` 渲染成一张卡片：标题一个输入框、正文一个输入框、
外加「列表 / 段落 / 引用」下拉决定这一块每一行落盘时加不加 `- ` 或 `> `。
卡片可以上下移动、删除，右侧「添加模块」按钮按预设名一键新建（也能自定义命名）。

**结构化只存在于编辑器里。** 落盘永远是上面那种纯 markdown，所以：

- 手改 `persona.md` 完全没问题，回到设置页会重新解析成块；
- 整个文件可以复制给别的包，不绑定任何专有格式；
- 块顺序 = 注入顺序，删一块就是删掉那个模块，其它块的位置和内容都不动。

`facts.md` 同理，但只有两层：非列表行（标题、`> ` 说明）进文件头，
`- ` 行进条目列表。设置页把每条渲染成一个输入框，回车在下方插入新条目。

### 临时停用一块

每个模块卡片上都有「停用」按钮。停用不改文件内容，只是让这一块**不进注入文本**：

- 落盘的是独立的 `muted.json`（`["语气", "背景"]`），跟 `persona.md` 分开，
  所以手改正文不会把开关搞乱；
- 匹配按**模块标题**走。改了标题，旧开关自动失效，不会误伤同位置的新模块；
- 停用态在编辑器里半透明 + 标题划线，顶部会显示「停用 N」；
- 只是试效果时用这个，别为了对比而删块、再重新搭回来。

### 从 Markdown 导入

「人格正文」「常驻事实」两个页签右上角都有「从 Markdown 导入」：

1. 把现成的设定（比如一份 `角色设定.md`）整段粘进弹层；
2. 点「识别」——宿主解析后回来告诉你切出了几个模块、分别叫什么；
3. 确认无误再选「替换全部」或「追加到末尾」。

识别规则和分块写法一致：`## ` 切块，第一个标题之前的算文件头，`// ` 开头的行是注释
（留在文件里、不注入）。导入只落到草稿，**要点保存才动文件**，所以可以放心先试。

### 版本快照

「设定档案」页底部是快照区。**每次保存前都会自动留一份**（`persona.md` + `facts.md` + `pack.json`），
也可以点「立即备份」手动留一份，回滚只作用于正文与事实两个文件：

- 存放位置：`~/.dsh/persona/.snapshots/<包 id>/<时间戳>/`；
- 内容没变时不会重复堆快照，默认最多留 20 份，超出从最旧的删；
- 点「回滚到这里」时，当前版本会**先自动备份**，所以回滚本身也能撤回；
- 删人格包时连带清掉它自己的快照，不会留垃圾。

---

## 四、注入原理

用的是官方 `ctx.systemPrompt.section()`，没有 patch 任何包：

```js
ctx.systemPrompt.section({
  name: 'persona:main',
  order: 9100,          // 工具清单(5000) 之后，结构化输出(9900) 之前
  interpolate: false,    // 人格文本里的 $ 和 {} 不当模板
  text: () => 读当前激活的人格包,   // 函数形式：每次组装重新求值
})
```

三个设计决定：

- **`text` 用函数而不是字符串** —— 每次组装提示词都重新读盘。所以切包、改文件、开关注入都不需要 dispose/register，更不需要重启。读盘有 mtime 缓存，不会每轮真读 IO。
- **`interpolate: false`** —— 人格文本里出现 `${...}`、`{name}` 这类字符是常事，不能被当模板求值。
- **求值失败一律降级成空串** —— 系统提示组装抛错会让整轮请求直接失败。人格包写坏一个字不该有这个后果。`config.strict = true` 可以关掉这层保护，用于调试。

## 五、工具

| 工具 | 作用 |
|---|---|
| `persona_status` | 现在是谁、注入了什么、档案与记忆规模 |
| `persona_packs` | 列出 / 新建 / 复制 / 切换 / 删除人格包 |
| `persona_recall` | 在长期记忆里按相关度检索 |
| `persona_remember` | 写一条记忆（偏好 2 / 约定 3 / 经历 4 / 底线 5） |
| `persona_forget` | 按 id 或内容删一条记忆 |
| `persona_lore` | 列章节 / 检索 / 读档案条目 |

## 六、接口

设置页通过 `/persona/api/*` 读写，全部 JSON，无鉴权（同源使用）：

```
GET  /persona/api/overview              概览：激活包、设置、全部包
GET  /persona/api/pack?id=<id>          单个包的完整内容
PUT  /persona/api/pack                  { id, file, content } 保存文件
                                        { id, file, doc } 保存结构化文档（宿主序列化）
POST /persona/api/pack                  { action: create|duplicate|delete }
PUT  /persona/api/active                { id } 切换激活包
PUT  /persona/api/settings              合并写入设置
GET  /persona/api/memory                记忆列表
POST /persona/api/memory                { action: add|forget|prune }
POST /persona/api/lore                  { action: chapters|search|read }
POST /persona/api/doc/parse             { kind: persona|facts, text } → 切好的结构
POST /persona/api/snapshot              { id, action: list|create|restore|remove, stamp? }
```

## 七、配置

写进 `settings.json`，或用插件 config 覆盖（config 优先，且不写回文件）：

```jsonc
{
  "enabled": true,
  "injectPersona": true,
  "injectFacts": true,
  "exposeTools": true,
  "order": { "persona": 9100, "facts": 9120 },
  "maxChars": { "persona": 24000, "facts": 6000 },
  "recall": { "limit": 5, "minScore": 0.12 }
}
```

部署级固定（config 里给，界面上不可改）：

| 键 | 作用 |
|---|---|
| `packId` | 钉死激活包，忽略 `active.json`，界面锁住切换 |
| `strict` | 注入求值出错时抛错而不是降级（调试用） |

## 八、自测

```bash
npm test          # 109 项：宿主 87 + 浏览器 22
npm run test:host
npm run test:client
npm run check     # index.js + client.js 语法检查
```

宿主侧（`test/run.mjs`）跑在临时 `DSH_HOME` 里，不碰真实数据，分五层：

1. 纯函数：分块、打分、包信息归一化
2. 文件层：包的增删改复制、档案检索、记忆增删与保留条数
3. 装配层：mock ctx 真跑 `apply()`，断言注入两段、order 落点、6 个工具都带 `output.schema` 与 `render`、改文件后段文本立刻变、注入关掉返回空串、人格文件写坏时降级不抛错
4. 接口层：起一个真 http server 挂上路由，用 fetch 走完设置页要用的每个接口，包括保存包信息不丢 `version`/`tags`、没有激活包时返回 409、结构化 `doc` 存下去落盘是 markdown 且读回来结构一致
5. 分块文档：解析/序列化往返稳定、文件头不丢、空块语义、删块后顺序不变、事实条目与说明区分、撞名标题自动补序号
6. 快照、模块开关与导入：保存前留底、内容不变不重复堆、回滚能退回、超上限淘汰最旧、删包连带清快照、停用块不进注入但仍在编辑器、改标题后旧开关失效、Markdown 整段导入切块

浏览器侧（`test/client-load.mjs`）把那层 UMD 和组件真跑一遍：模块自注册、`apply` 只注册 `settings.section`、数据未到时是加载态而不是「没有包」、数据到齐后四个页签都在、人格正文页渲染出模块卡片而不是一整块输入区、停用态有视觉标记、档案页快照区带时间与回滚按钮、导入弹层先识别后给替换/追加。渲染用一层极简 React 垫片，不需要真实浏览器。


## 九、边界

- **两个进程各写各的**：设置页与模型工具都会写 `memory.jsonl`，用追加 + 原子写，但没有文件锁。同一时刻并发写的概率极低，不值得为此引入锁。
- **不接管既有系统提示**：只插入自己的两段。想替换 harness 身份段请用部署级 `personaPrefix/personaSuffix`，那不是本插件的职责。
- **内置包不可改**：编辑时自动 fork 到用户目录，原文件保持干净。
- **档案检索是词频 + 长度归一的轻量打分**，不是向量检索。几千条档案够用；上万条建议自己拆包。

## 十、许可

MIT。
