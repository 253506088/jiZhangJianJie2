# 浏览器端到端验证

所有测试使用 Playwright 创建的新临时浏览器 context，不连接用户现有 Edge/Chrome profile。日期固定为 2026-11-08（Asia/Shanghai），视口为 390 × 844。

Excel 文件由 `helpers.ts` 使用 SheetJS 在内存中生成；只包含标记为虚构的数据，没有读取用户文件。这里验证 `.xls/.xlsx` 解析与已配置字段的端到端行为，不能把合成文件当作原 APK 实际生成的导出样本。旧版格式取证仍由 M02 单独完成。

## 测试范围

- `ledger.spec.ts`：空账本、两级分类与金额键盘、连续记账、2018 历史数据导入后在当前年份继续记账、全部月份 3 笔 30 元、重复导入、持久化、父子合并/别名再导入、转账编辑删除、主题、弹窗错误、未保存返回、错误行确认和导入取消。
- `management.spec.ts`：分类排序与归档恢复、账本隔离与切换、账户期初余额、归档账户保留历史编辑关联、预算与模板的创建/使用/编辑/删除及金额一致性。

## 运行

根 `playwright.config.ts` 选择现有系统 Edge、headless 模式、本地地址 127.0.0.1:5173，并把临时目录和输出放在被忽略的 `.tools/`。

```powershell
npm exec playwright -- test tests/e2e --reporter=line
```

分组运行时可指定不同输出目录保留各自截图：

```powershell
npm exec playwright -- test tests/e2e/ledger.spec.ts --output=.tools/e2e-ledger-final
npm exec playwright -- test tests/e2e/management.spec.ts --output=.tools/e2e-management-final
```

不要通过 `force:true`、直接改数据库、删弱断言或跳过必要页面来绕过产品缺陷。字段选择器需要与真实 UI 对齐；多个同名合法按钮应明确限定所在页头、弹窗或卡片。

这些测试验证 Web/IndexedDB 路径。Android SQLite、系统返回、文件选择/保存和安装运行必须另行实机或隔离模拟器验收，不能用浏览器通过代替。

## 2026-11-08 验证结果

在当前正式界面工作树上统一执行 `ledger.spec.ts` 与 `management.spec.ts`：**12 项通过，耗时 31.6 秒**。结果和关键截图保存于 `.tools/e2e-ui-complete/`（不提交 Git）。

期间发现导入成功提示和页面操作提示可能遮挡底部保存按钮，已修复为不拦截点击的瞬时提示。预算/模板用例在提示仍可见时验证真实点击命中目标，未使用强制点击绕过。

随后新增 `legacy-v2.spec.ts`、`legacy-loan-import.spec.ts` 和 `legacy-save-again.spec.ts`，覆盖新默认概况、经典选择保留、四借贷、成员/收入单层、数字键盘返回和已确认的再记一笔行为。既有12项在用户可选择的经典模式下回归，新默认概况另行验证。

`helpers.ts` 的 `originalLegacyFixture()` 和 `originalBorrowFixture()` 只读取 `tests/fixtures/` 内已确认全部虚构、由未修改原 APK 导出的固定文件，并先校验 SHA-256。它们与 SheetJS 合成数据区别明确，不能互相替代来源证据。

v2早期集中运行19项通过，随后完成原版独立预算、借贷再记和历史日期重置的取证与实现。最终候选统一29项通过（约1.4分钟），证据和截图在 `.tools/e2e-release-candidate/`。四表导出下载、密码备份、日周月预算及借贷再记均已纳入自动回归。原包全部功能和全部机型不属于这些有限测试的证明范围。
