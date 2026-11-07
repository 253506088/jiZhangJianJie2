# 进展与验证记录

## M01 · 项目隔离与版本管理（已验证）

- 用户授权完整实现、逐项验收、每项推送 Git 远端。
- 检查远端：SSH 访问成功，HEAD 无已发布分支；本地此前不是 Git 仓库。
- 初始化 main 与 origin，保留已有根目录文件；把现有 UI 源码/资源完整复制到 prototypes/ui-v1。
- 新增原始 APK/反编译结果、个人数据、密钥、本机配置和生成产物的忽略规则。
- 旧版 APK SHA-256（已核对的输入身份）：5558eec535ccc9b469ead5c78e2785374c660c781125ac2894c2775e32eee1a0。
- 验证通过：npm test（9项）、npm run build、npm run build:prototype。
- git check-ignore 确认 APK、analysis/、.tools/、.local/ 和私人 Excel 示例路径均被排除。
- 提交记录以 Git 中 `[M01]` 开头的提交为准；完成后同步 main 至 origin。

## M02 · 旧版格式调查（进行中）

- 静态资源只有导出时间范围、目录和确认入口，尚未确定实际列名。
- 正在使用本项目专用空白 AVD 调查旧 APK，不连接既有模拟器或物理手机，不读取真实账本。
