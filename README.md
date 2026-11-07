# 简洁记账 · 界面预览

> 已进入正式重制开发，完整目标和逐项进度见 [执行清单](docs/TODO.md)。下文描述目前保留的界面基线，正式功能将随里程碑更新。旧预览已独立封存在 prototypes/ui-v1，可用 `npm run dev:prototype` 在 5174 端口运行。

开发根目录：`D:\code\my\2\记账`。

按照用户要求，从当前根目录使用 **React + TypeScript + Vite + Capacitor** 开发。旁边的 keepaccounts-reborn 目录不再作为开发入口。原 APK、已有反编译和 REA 证据仍保留在本目录。

当前交付是可操作的浏览器界面预览，用于确认外观和操作习惯，尚不是可以存放真实账本的完整 App。所有初始记录均为虚构数据，修改仅存在当前页面内存中，刷新恢复示例。不要导入真实 Excel 或备份。

## 运行与检查

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。较宽窗口同时展示设计说明和设备预览，窄窗口直接展示移动端界面。可在页面里切换暖白/夜间主题。

已提供：首页月度收支、左右两级分类、带加减法的金额键盘、保存/再记一笔、流水编辑/删除、按月明细、账户余额、二级分类报表、仅演示格式的 JSON 备份导出/恢复。

```powershell
npm test
npm run build
npm run format:check
```

## 技术栈与维护

| 位置 | 职责 |
| --- | --- |
| src/App.tsx | 页面切换、演示状态和确认弹窗 |
| src/pages/ | 首页、记一笔、明细、账户、报表、数据页 |
| src/components/ | 图标、流水列表、月份选择和确认弹窗 |
| src/domain/ledger.ts | 金额、类别关联、统计、记录验证与演示备份格式 |
| src/domain/ledger.test.ts | 用虚构记录验证金额、统计关联、编辑、日期和备份 |
| src/styles.css | 颜色变量、暖白/夜间主题与响应式布局 |
| capacitor.config.ts | Android 包名、显示名称和前端构建目录 |

Node.js 只用于本机开发和构建。Capacitor 将构建后的 Web 界面放入 Android 原生容器，系统能力通过插件连接，不需要在手机上运行 Node.js 服务。未来应新增独立的数据访问层处理持久化，不把数据库操作混进页面组件。

本机现有 Node.js 24.13.0 可用于前端，无需切换 nvm。构建 Android 时可以在构建进程内单独使用已有的 `C:\Users\black\.jdks\corretto-21.0.10`，不修改全局 JAVA_HOME 或 PATH。本项目不依赖 REA 专用的 Node.js 24.22.2。

## Android 容器

```powershell
# 首次生成 Android 工程，仅在 android/ 不存在时运行
npm run android:add
# 构建前端并同步到已有 Android 工程
npm run android:sync
npm run android:open
```

预览包名 dev.keepaccounts.preview 与旧版 com.yu.keepaccounts 不同。当前没有声明 APK 已编译或实机测试通过，本轮以浏览器预览为验收。安全区、返回键、持久化数据库、原生文件导出和真机兼容性需要单独实现/验收。iOS 工程未配置，其原生构建需要 macOS。

## 复刻依据与界限

- 原始简洁记账.apk、版本 4.8.8 (89)，保持原样。
- analysis/jadx/resources/ 中已提取的布局、颜色、文字和样式用作参考。
- 圆形收支区域、四个常用入口、左右分类、加减键盘和保存/再记一笔来自资源线索；新排版、主题、示例分类及默认值是本次设计选择，尚非经过验证的像素级复刻。
- 原包使用 360 加固，业务代码尚未恢复。当前 TypeScript 账本规则为新实现。
- 尚未实现旧版 Excel 兼容、长期持久化、分类管理/合并、转账或云同步。真实历史账本不是推进开发的前提。

详见 [界面说明与验证记录](docs/ui-preview.md) 和 [已有 APK 分析](analysis/反编译分析与改造建议.md)。REA 证据位于 analysis/rea-rebuild-evidence.json，Excel 静态复核位于 analysis/excel-static-surface.json。

参考：[Capacitor Android 官方文档](https://capacitorjs.com/docs/android)。

