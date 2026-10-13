# 镜头保存等待的排查记录

2026-10-13 核对了前一天 14 个镜头的测试记录。模型占位从启动到释放约 25–42 秒；4 个镜头在释放后约 4–6 秒完成保存，另外 10 个镜头在释放后约 371–972 秒完成保存。记录支持“主要空档发生在模型返回之后”，但占位释放时间包含少量应用处理耗时，不能当成精确的模型响应计时。

历史终端记录没有保留这些保存事务的内部阶段。只读检查时没有活动的数据库锁等待，数据库累计死锁计数为 0；这些信息无法排除历史上的锁等待、连接等待或执行器退出。因此，历史中断的唯一根因仍未确证。

在隔离的真实 PostgreSQL 中，持有父任务行锁可以复现“答案已暂存、正式结果未保存”。保存的两个尝试都在 `lock_parent_task` 阶段触发锁等待上限；释放锁后恢复成功，模型只调用一次、只生成一份结果、只结算一次。这个测试证明了锁等待保护有效，没有证明历史的十次中断都由同一原因引起。

保存日志现在分别标记检查点写入、获取事务连接、设置事务参数、锁定镜头、锁定父任务、插入结果、更新状态、更新父任务进度和提交事务。超过 5 秒会报告当前阶段；失败时保留阶段耗时和经过脱敏的错误原因。事务同时设置锁等待、语句执行和事务内空闲时间上限。正常结果的 `result.timings.saveStagesMs` 保留提交前已完成步骤的耗时；完整提交耗时由 `commercial.scene.save_transaction_finished` 日志记录。

下一次真实视频测试应核对 `checkpoint_finished`、`save_transaction_finished`、`save_slow` 和 `save_failed`。检查点开始后没有完成记录，说明仍需检查写入确认或执行器退出；若明确报告 `acquire_connection`、`lock_parent_task`、`insert_scene_result` 或 `commit_transaction`，就能继续定位对应环节。

补位调度已改为每轮最多同时派发 5 个请求，单个视频仍限制为两个运行位置。一个派发请求返回慢时，其他位置无需等待它。派发完成后主动释放响应体；本地父任务和镜头任务都通过直接连接绕开开发环境的全局代理。已知模型结果的 API 占位释放与父任务进度更新合并在保存事务的同一条 SQL 中，提交成功后即可派发下一镜头；结果未知的请求继续保留占位。`analysis.dispatch.accepted` 记录派发确认耗时。

这轮验证通过 141 项常规测试和 8 项真实 PostgreSQL 场景，类型检查通过。测试覆盖慢派发不阻塞第二个位置、派发失败时批次上限、响应体释放、并行上限、保存错误、父任务锁等待、恢复不重复推理与一次结算。真实视频上的总耗时变化仍待对比；这些测试没有证实历史十次中断的唯一原因。

常规测试使用内存 PostgreSQL。真实驱动诊断可通过 `SCENE_SAVE_TEST_DATABASE_URL` 启用，入口仅接受 `127.0.0.1:55432/scene_save_diagnostics`。该库必须是专用临时测试库，测试启动会重建其 `public` schema。模型和支付请求仍使用模拟实现。临时数据库二进制和数据保存在被 Git 忽略的目录，未添加到项目依赖或功能提交。

```powershell
$env:SCENE_SAVE_TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:55432/scene_save_diagnostics'
npx vitest run tests/commercial-wallet.test.ts -t 'blocked parent lock|independent durable|claims at most|settles one parent|checkpointed scene|preserves the model answer|terminal scene parent'
```
