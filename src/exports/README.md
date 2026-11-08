# 四表 Excel 明细导出

导出结构依据未修改简洁记账4.8.8在隔离环境生成的虚构样本，见 `docs/LEGACY-FORMAT.md` 和 `tests/fixtures/legacy-4.8.8-full-types.xls`。所有开发测试只使用虚构数据。

## 接口与层次

- `summarizeExcelExport(state, {bookId, format, fromDate?, toDate?})`：只读范围/笔数/精确合计；金额合计为 BigInt 派生的整数分字符串，不转换为不安全浮点数。
- `prepareLegacyExport`：生成四张表的实际文本单元格及摘要，验证XLS行数边界。
- `buildLegacyExcel`：SheetJS编码，返回 `{bytes, fileName, mimeType, summary}`。仅生成数据，不写数据库或文件。
- `generateExcelExport`：在Web Worker生成，90秒上限，可在准备阶段取消，不会修改账本。
- `ExcelExportPanel({state,onClose,onSaved?})`：单账本、日期区间/全历史、XLSX或XLS选择，以及保存结果。可选ref的`requestClose()`会取消生成，原生文件写入中返回false；此时应在系统保存器中取消。
- `saveBinaryFile(bytes,fileName,mimeType)` 位于 `src/backup/files.ts`。Web使用真实Blob下载；Native用`encoding:'base64'`把字节交给`LedgerFiles.saveDocument`，由系统SAF选择位置。与UTF-8文本路径分开，不能把二进制当文本写入。

## 格式细节

工作表固定为 **支出、收入、转账、借贷**。前3行分别为类型名（仅支出/收入有普通合计）、时间范围、原中文表头。空表仍保留3行。金额写为不带千分位的两位小数字符串；转账和借贷本金不混入普通收支。

日期区间包含用户选择的起止日。全历史使用实际明细的首末日期作元信息；完全无流水时标为“全部历史”。这说明的是当前筛选范围，不冒称已确认原版排他结束日的含义。

原分钟时间在值未改变时仍为`yyyy-MM-dd HH:mm`；明确记录了秒的时间保留秒；无时间的记录只导出日期，不补造零点。当前成员/借贷人名称按稳定关联读取，转账类型为空就保持空，不用“转账”填造它。

收入采用原版单层字段。正常隐藏父“收入”只写叶子名；迁移前遗留其他父结构时写可见完整“父 / 子”名称，不能假装保留了原来的私有层级。当前导入器会把可接受长度的完整名称作为单层名称；合并文本若超过其分类名称限制会明确报错，不应截断。原样迁移这类结构应使用完整备份。

## 界限

- XLS每表最多65,533条明细，加3行正好65,536行；超限明确拒绝并建议XLSX，绝不截断。
- XLSX足以容纳当前模型允许的明细数量；输出文件设32MiB上限，超限建议缩小日期范围或完整备份。
- Excel没有稳定ID、期初余额、类别历史别名、预算/模板和来源批次。完整迁移与精确保留关联使用完整备份；Excel是明细交换格式。
- 本实现依据原版字段和虚构文件往返验证，不声称可恢复未被旧版Excel导出的信息。

Native先严格验证Base64长度、字符和填充，再流式解码到私有临时文件；正文从待保存Activity的PluginCall移除，避免大Bundle。实际输出按解码后的字节数与SHA-256读回校验，取消不算成功。现有JSON/CSV文本导出接口保持兼容；所有临时文件仍按原私有导出缓存策略清理。
