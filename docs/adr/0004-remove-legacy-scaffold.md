# ADR 0004: 删除遗留前端与后端脚手架

## 状态

已接受 (2026-06-25)

## 背景

仓库历史上存在三套已被取代的代码，长期与活跃代码并存：

| 遗留物 | 取代者 | 状态 |
|--------|--------|------|
| `src/`（React 18 旧前端，14 文件） | `app/`（React 19 + Vite 7 + OSMD） | 不在任何运行路径上 |
| `pianoscore-api/`（Python/FastAPI 旧后端，8 文件） | `server/`（Node + Hono + Drizzle） | 不在任何运行路径上 |
| 根目录 `index.html` / `vite.config.ts` / `tsconfig.json` / `tsconfig.node.json` / `tailwind.config.js` | `app/` 内自包含的对应配置 | 只服务于已删除的 `src/` |

Tauri（`src-tauri/tauri.conf.json`）与所有构建、测试工具链均已切换到 `app/`，根 `package.json` 不再含 Vite/React 脚本。

`.kiro/specs/pianoscore-mvp/` 的早期规划文档（`design.md` "与现有代码的取舍"、`tasks.md` 任务 F1）曾做出相反的决策：**保留 `pianoscore-api/` 与 `src/` 作参考**，仅在旧后端 README 标注 DEPRECATED，不删除。本 ADR 记录对该规划决策的偏离。

## 决策

**删除全部遗留脚手架，而非标注废弃后保留。**

删除清单（见 commit `240a837`）：

- `src/`（14 文件）
- `pianoscore-api/`（8 文件）
- 根目录 Vite/TS/Tailwind 配置（5 文件）
- `app/info.md`、`app/README.md`（Vite/shadcn 模板样板，非项目文档）

### 决策依据

1. **零活跃引用**：全仓 grep 对 `src/` 的导入/引用为 0；Tauri 配置与 E2E 均指向 `app/`，无任何路径回退到旧前端。
2. **双套代码的认知负担**：两套前端 + 两套后端并存会让新贡献者误判运行路径，与需求 6.1（"避免误以为有两套后端"）的初衷相悖。标注 DEPRECATED 只能提示，不能消除"两份代码漂移、不知哪份为准"的实际混淆。
3. **可恢复性**：删除走 git，历史完整可追溯。任何需要参考旧实现的场合，`git show <hash>:<path>` 或 `git checkout <hash> -- <path>` 即可取回，无需在主干保留死代码。
4. **配置耦合**：根 Vite/TS 配置仅服务于 `src/`，保留 `src/` 删除其配置、或保留配置删除 `src/`，都会产生悬空引用。二者必须同生同灭，故一并删除。

`app/dist/` 为本地构建产物，从未被 git 跟踪（`.gitignore` 已忽略 `dist/`），属磁盘副作用，不进入任何 commit。

## 考虑过的方案

### 方案 A：按原 spec 保留并标注 DEPRECATED（`design.md` / `tasks.md` F1）

在 `pianoscore-api/README.md` 与 `src/` 加 DEPRECATED 标记，不删除。

**否决原因**：标注无法消除双套代码的实际混淆（见决策依据 2）；死代码仍会随依赖升级、lint、类型检查产生噪音；"保留作参考"的诉求已由 git 历史完整满足（见决策依据 3）。

### 方案 B：仅删除 `src/`，保留 `pianoscore-api/`

前端先行清理，后端暂留。

**否决原因**：后端同样是零引用的死代码，且 Python `venv/` 在 `.gitignore` 中印证它曾是独立项目。没有理由对两套同性质的遗留物采取不同策略，半清理反而制造"为什么这个留了那个没留"的新疑问。

### 方案 C：物理删除并用 `git filter-repo` 抹除历史

彻底从仓库历史中移除，减小体积。

**否决原因**：改写历史是破坏性操作，会改变所有 commit hash，需团队协调。本次仅做正向清理（untrack + delete），历史抹除作为独立议题留待将来评估。

## 后果

- **`.kiro/specs/.../design.md`、`tasks.md` 与现实不符**：这两份是 `.kiro/`（gitignored）下的本地历史规划文档，不进版本控制，本 ADR 不修改它们——偏离由本 ADR 在仓库内正式记录。
- **`CODEBASE_SUMMARY.md` 第 140 行**（"均已在后续重构中移除"）在本次清理后变为准确陈述，无需改动。
- **仓库体积**：`node_modules/` 的历史跟踪问题在同批 commit `7c219be` 中单独处理（解除跟踪、磁盘保留）。遗留脚手架本身仅 27 个源文件，体积影响可忽略。
- **取回方式**：如需参考旧实现，`git checkout 240a837^ -- src/ pianoscore-api/`。
