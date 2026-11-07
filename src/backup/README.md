# 完整账本备份协议 v1

仅负责内存中的编解码与验证，不选择文件、不替换数据库、不写日志。真实账本恢复必须由用户在本机确认，repository 再执行原子替换。

编解码器保持上述边界；同目录新增的 `BackupPanel` 与 `files.ts` 负责用户发起的文件交互。

## 界面与文件接口

- `BackupPanel({ mode: 'export' | 'restore', state, onClose, onRestore, onSaved? })`：提供完整范围摘要、可选密码加密和恢复前确认。`onRestore` 必须返回底层原子替换完成后的 Promise；成功之前不会关闭面板或提示恢复成功。
- 可选 `ref: BackupPanelHandle` 暴露 `requestClose(): boolean`。父级 Android 返回键应调用它，返回 false 时保持面板，避免中断正在进行的恢复/保存。
- 加载失败时可传 `currentUnavailable: true`，此时 state 仅供主题壳使用，面板明确说明当前账本数量未知，不显示虚构的0笔；只允许恢复，不导出空白替代数据。父级必须使用可保留旧原始快照的原子恢复方法（如 repository.restoreFromBackup），而非要求旧损坏快照先通过校验的普通修改方法。
- `saveTextFile(content, fileName, mimeType = 'application/json')` 返回 `{ cancelled, delivery: 'document' | 'download' }`。导入错误行报告也可使用 `text/csv`。浏览器结果表示开始下载，不等于已确认落盘；安卓结果等待原生文件写出及读取校验完成。
- `readBackupFile(file)` 只接受用户选择的 `.jzbackup` / `.json`，在读取前检查上限，以严格 UTF-8 解码；旧 Excel 应走导入向导。
- `exactMoney` 用十进制整数分字符串生成显示值，不将超大合计转换成浮点数。

Android 的 `LedgerFilesPlugin` 需由主 Activity 注册。它使用 ACTION_CREATE_DOCUMENT，不申请广泛文件权限；正文先写入 App 私有缓存，并从待保存的 PluginCall 状态移除，避免打开系统文件选择器后保存 Activity 状态时超出 Binder 限制。临时文件在完成/取消后删除，旧临时文件在后续导出时清理。成功输出会校验完整字节数和 SHA-256；失败不会修改账本，也不会删除任意文件提供器 URI。

界面密码只存在组件内存，完成操作/关闭后清除。所有检查只使用虚构测试数据。应用还应将 Capacitor 的 `loggingBehavior` 设为 `none`，避免框架层 verbose 日志记录桥接参数。

- `encodeBackup(state, { password?, createdAt? })`：返回 JSON 文本。未提供 password 时为明文；提供空密码不会悄悄退化为明文。新加密密码至少 8 字符，上限 1024 字符。
- `inspectBackup(text)`：返回格式、版本、导出时间、是否加密/需要密码、文件字节数。明确标记完整性尚未验证，不返回账目或账户值。
- `decodeBackup(text, { password? })`：只有格式、加密认证、摘要与模型校验全部通过才返回 `{ state, metadata }`；metadata 带已验证标志和本机恢复预览 summary。
- `summarizeBackupState(state)`：返回笔数、类别/账户数、日期范围与整数金额合计，用于本机确认界面；模块不打印或上传这些值。

Summary 总额用 BigInt 汇总。正常情况下 incomeCents/expenseCents/transferCents 是安全整数；超过 JS 安全整数时，对应值为 null、totalsSafe 为 false，完整十进制整数分仍在 exactTotals 中。调用方不能把 null 当作 0；这避免仅因展示摘要溢出而拒绝恢复一份有效备份。

文件 magic 为 `jizhang-jianjie2-backup`，版本 1。扩展名可用 `.jzbackup`，内容为 UTF-8 JSON。任何未知外层字段、算法、参数或版本均拒绝。

明文文件：顶层 `format/version/createdAt/encryption/data/integrity`。摘要计算对 `format/version/createdAt/encryption/data` 的键排序规范 JSON 执行 SHA-256。

加密文件：顶层 `format/version/createdAt/encryption/kdf/cipher/ciphertext`。AES-256-GCM 使用随机 12 字节 IV、128 位认证标签；PBKDF2-SHA-256 使用随机 16 字节 salt、600,000 次迭代。全部外层元数据与密码派生/密码算法参数作为 GCM AAD，不能被无声篡改。密文中的 `{ data, integrity }` 再验证 SHA-256。明文密码和密钥不出现在文件中；密钥不可导出。

解码仅接受 100,000 至 2,000,000 次 PBKDF2，先验证范围再派生，避免恶意超大工作因子。账本数据上限 64 MiB，文件上限 96 MiB（为 Base64 和加密认证开销留空间）。编码不压缩，因而没有压缩包膨胀路径。深层非模型数据也受规范化深度限制。

SHA-256 是完整性校验，不是签名：能防止意外损坏，但不能证明明文备份来自可信作者。加密备份的密码和 GCM 提供内容认证。错误信息只描述错误类型，不包含密码、密文、流水值或备注。
