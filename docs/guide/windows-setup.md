# Windows 环境：让 agent 发现 skills

本文是在 Windows 上让 agent 发现 skills 的操作指南：先判你现在处于哪种状态，再选一条修法。读者是在 Windows 上用本仓的工程师。Linux 与 macOS 上 clone 后即可用，不必读。

## 1 做完得到什么

`python3 scripts\enable_agent_skills.py --check` 以 0 退出，且每条输出都是 `[<agent>] ✅ 正常`，agent 能发现 skills。修法 ① 修完 `git status` 干净，pull / rebase / reset 无任何特例。

## 2 前置条件

- 本仓通过 `.dsh/skills → ../skills` 的相对 symlink 让 agent 发现 skills，这个 symlink 是 git 跟踪的条目（index mode `120000`）。
- Git for Windows 默认 `core.symlinks=false`，clone / worktree 都不会还原 symlink，于是 `.dsh/skills` 落成一个普通文本文件（内容为 `../skills`），agent 把它当文件读，发现不了 skills。
- 修法 ① 需要 Windows 10+ 的「开发者模式」。修法 ② 需要 `python3`。
- 仓库已带 `.gitattributes`（`* text=auto eol=lf`），所有文本文件在 Windows 上也按 LF 检出，避免 CRLF 在 YAML/脚本里引发解析失败或 diff 噪音。

## 3 步骤

1. 自检当前状态。

### 先自检：你现在在哪种状态

```powershell
python3 scripts\enable_agent_skills.py --check
```

它只读：不写盘、不改 git 配置，逐条打印每个 agent 的 `skills` 状态；出现 `✅ 正常` 以外的状态时以 1 退出。自动检测只覆盖已装且用过的 agent，要六个都看加 `--all`：

```powershell
python3 scripts\enable_agent_skills.py --all --check
```

| 状态 | `--check` 的说法 | `PSIsContainer` | 现象 |
|---|---|---|---|
| ① 真 symlink 或 junction（正常） | `✅ 正常` | `True` | agent 能发现 skills |
| ② 普通文本文件（clone 默认） | `内容为 ../skills 的普通文件` | `False` | 长度 9、内容 `../skills`；`git status` 可能为空 |
| ③ 破损的 reparse 点 | `链接解析不到内容` | `False` | 长度 0、内容读不出；`git status` 显示 ` M .dsh/skills` |
| ④ 目录副本（Git Bash `ln -s` 退化） | `是目录副本，不是链接` | `True` | agent 能发现 skills，内容却停在做出副本那一刻 |
| ⑤ 目录副本含额外文件 | `含 skills/ 之外的内容` | `True` | 同 ④，并且夹带使用者自己放的文件 |

没有 Python 时用这两条命令。`PSIsContainer` 只能区分「链接或目录」与「文件」，分不出 ① 与 ④，两者都是 `True`：

```powershell
(Get-Item .dsh\skills -Force).PSIsContainer
git status --short -- .dsh/skills
```

2. 状态为 ① 时不修。状态为 ②、③、④、⑤ 时，选修法 ① 或修法 ②。

3. 开真 symlink（首选）。clone 前 `git config --global core.symlinks true`；已经 clone 的原地修（不用重新 clone）：

```powershell
git config core.symlinks true
Remove-Item .dsh\skills -Force     # 删掉 clone 残留的文本文件（或破损的 reparse 点）
git checkout -- .dsh/skills        # 重新检出为真 symlink
```

状态 ④ 与 ⑤ 是目录，`Remove-Item` 要加 `-Recurse`；⑤ 先移走自己的文件，否则会被一起删掉。

4. 开不了开发者模式时，用脚本建 junction。脚本不看检测结果，一定修 `.dsh/skills`。它是本仓自己跟踪的条目，任何模式（含 `--agents`）都修。原因在 DSH Desktop。它的 home 在 `%APPDATA%\dsh-desktop\harness`，`dsh` 命令也不在 PATH。人手动开的 PowerShell 里两条检测都不成立。其余 agent 只修检测到的，Windows 上逐个打印跳过原因；要六个都建用 `--all`。脚本先试真 symlink，无权限时退到 `mklink /J` 目录链接（免管理员）。git 侧适配随链接类型走。真 symlink 设 `core.symlinks=true`；junction 打 `git update-index --skip-worktree`。

某个目录已存在却不是链接时，脚本按状态处理：② 与 ③ 直接修好；④ 默认只报告，加 `--fix-copy` 才在确认副本里没有额外文件后替换成链接；⑤ 一律不动，列出外来文件。没修好的项以非 0 退出。以下是手工版（不看检测，六个目录全建）：

```powershell
# 在仓库根目录运行
foreach ($d in '.dsh','.claude','.cursor','.trae','.codebuddy','.codex') {
  New-Item -ItemType Directory -Force $d | Out-Null
  # 清掉克隆残留的同名文本文件（若非目录）
  if ((Test-Path "$d\skills") -and -not (Get-Item "$d\skills" -Force).PSIsContainer) { Remove-Item "$d\skills" -Force }
  if (-not (Test-Path "$d\skills")) { New-Item -ItemType Junction "$d\skills" -Target (Resolve-Path .\skills) | Out-Null }
}
git update-index --skip-worktree .dsh/skills   # 让 git 忽略 junction 造成的类型变更
```

## 4 怎么确认做对了

- `python3 scripts\enable_agent_skills.py --check` 以 0 退出，且每条都是 `✅ 正常`。
- 修法 ① 修完 `git status` 干净。

### 为什么不能只看 `git status`

`git status` 取决于 `core.symlinks` 的当前值，同一个磁盘状态会给出不同答案：

- `core.symlinks=false`（Git for Windows 默认）：git 把「内容正好是 symlink 目标的普通文件」视为未变更，状态 ② 的 `git status --short -- .dsh/skills` 输出为空。
- `core.symlinks=true` 而磁盘上仍是那个文本文件：同一台机器上同一状态显示 ` T .dsh/skills`（类型变更）。

两条都实测于 git 2.55.0.windows.5：先以默认 `false` 观察为空，随后 `git config core.symlinks true` 后同一文件变成 ` T`。

所以「status 干净」既可能是修好了、也可能是状态 ②；只有显示 ` T` 能确定没修好。判据用 `--check` 或 `PSIsContainer`，别用 status。

### 为什么不能只用 `PSIsContainer`

状态 ① 与 ④ 的 `PSIsContainer` 都是 `True`。④ 是目录副本：agent 读得到 skills，但内容不随 `git pull` 更新，`SKILL.md` 改了也不会同步。两者的区别不在「是不是目录」，在路径是不是 reparse point，`--check` 读的就是这个。

### 多 worktree 下的注意

`git worktree add` 新建的 worktree 同样按 `core.symlinks` 的当前值检出，上面五种状态在每个 worktree 里各自独立出现。不要用主检出修好就假定 worktree 也好了；每个检出各跑一次 `--check`。

## 5 出错了怎么办

- 用 Git Bash 的 `ln -s` 补建：它在 Windows 上默认退化成复制，建出的是 `skills/` 目录副本。副本读得到 skill，但 `git pull` 更新 SKILL.md 不再同步。`--check` 能认出这一态，`--fix-copy` 在确认没有额外文件后换成链接。
- `含 skills/ 之外的内容`：脚本不删目录，只列出外来条目。移走这些文件后加 `--fix-copy` 重跑。
- `指向 <别的路径>`：那个链接不是本脚本建的，删除前先确认它指向什么。
- 永久脏状态或 `git pull --rebase` 每次都失败：`enable_agent_skills.py` 会自动打 `git update-index --skip-worktree`。该路径在仓库里是内容固定的 symlink 条目，日常 pull 不会碰它；万一上游真改了这个链接，git 会拒绝合并，按提示先 `git update-index --no-skip-worktree .dsh/skills` 再重来。
- `git status` 干净不等于修好了：它既可能是状态 ①，也可能是状态 ②。判据见「怎么确认做对了」。

## 6 怎么退回去

无。原文没有给出独立的回滚步骤。修法 ② 的 `--skip-worktree` 如需撤销，见「出错了怎么办」的 pull 冲突处置。
