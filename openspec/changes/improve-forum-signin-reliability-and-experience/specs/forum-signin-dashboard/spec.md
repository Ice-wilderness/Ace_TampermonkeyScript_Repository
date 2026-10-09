## MODIFIED Requirements

### Requirement: Modern dashboard interface

控制台 SHALL 提供清晰、响应式的每日签到界面，分别展示人工待办、自动处理中、失败待处理及已完成目标，并区分自动确认、手动确认和今日跳过。

#### Scenario: Dashboard opens
- **WHEN** 用户在 Limestart 打开控制台
- **THEN** 控制台 MUST 展示每日成功、失败、待处理及未开始统计，并使跳过数量可见
- **AND** 每个目标 MUST 显示名称、状态、原因、更新时间、确认来源和适用操作
- **AND** 正在自动处理与需要用户登录或验证的目标 MUST 分开呈现
- **AND** 界面 MUST 保持清晰间距、状态标记和可读文字，已完成区域默认折叠且可展开

#### Scenario: Dashboard is viewed on a narrow viewport
- **WHEN** 控制台位于较窄视口
- **THEN** 列表 MUST 可滚动或合理换行
- **AND** 主要操作 MUST 可见且不重叠，不能出现无法理解的截断文案

### Requirement: One-click open for required sign-in sites

控制台 SHALL 提供处理所有启用且今日未完成目标的批量入口，通过立即并行的直签或独立前后台页面执行，并排除正在处理或已有有效页面任务的目标。

#### Scenario: User opens unfinished targets
- **WHEN** 用户点击一键处理未完成目标
- **THEN** 控制台 MUST 调度启用且未成功、未跳过、非在途的可自动处理目标
- **AND** 仅打开待确认模式的目标 MUST 在实际打开成功后记录为已打开
- **AND** 禁用目标及配置为手动打开的页面目标 MUST NOT 被批量打开
- **AND** 重复点击 MUST NOT 重复执行在途任务或重复打开有效任务页面

#### Scenario: Target requires foreground handling
- **WHEN** 批量操作包含需要前台处理的目标
- **THEN** 控制台 MUST 立即为每个可启动目标独立打开标签页
- **AND** 用户 MUST 能轮流激活各标签继续签到，不必等待其他站点
- **AND** 控制台 MUST NOT 设置前台串行队列或“继续下一项”操作
- **AND** 未确认完成时 MUST 明确提示所需的登录、验证码或其他人工操作

### Requirement: Daily status records

脚本 SHALL 在兼容既有成功日期的前提下记录每日状态、确认来源与可恢复原因，并在重置或撤销后使控制台状态和站点执行判断一致。

#### Scenario: Script-detected sign-in succeeds
- **WHEN** 站点适配根据明确证据确认当前账号当日完成
- **THEN** 脚本 MUST 继续更新既有成功日期记录
- **AND** 控制台 MUST 显示当日成功及自动确认来源

#### Scenario: Sign-in attempt fails
- **WHEN** 签到失败、异常、人工阻塞或到期仍未确认
- **THEN** 控制台 MUST 记录对应非成功状态及可读原因或阶段
- **AND** 已提交但结果未知 MUST NOT 被当作成功
- **AND** 等待登录或验证码 MUST 与执行失败区别显示

#### Scenario: A new day begins
- **WHEN** 控制台在新日期打开或常驻页面跨过本地午夜
- **THEN** 没有今日成功记录的目标 MUST 显示为今日待处理
- **AND** 既有最近成功日期 MUST 保留，过期每日历史仅按历史清理设置处理
- **AND** 昨日任务或提示计数 MUST NOT 直接继承为今日执行结果

## ADDED Requirements

### Requirement: 稳定输入与不打断的界面更新

搜索、输入与配置编辑 MUST 在状态更新时保持可用；后台更新 MUST 保留焦点、中文组合输入、滚动位置和未保存配置，且不能改变用户当前视图或重新打开已关闭的面板。

#### Scenario: 用户使用中文输入法搜索
- **WHEN** 用户输入搜索词且中文输入法正在组合输入
- **THEN** 搜索框自身的事件 MUST 正常接收
- **AND** 控制台 MUST 等组合输入完成后再应用筛选，不重建正在输入的控件

#### Scenario: 任务完成时正在配置
- **WHEN** 后台签到完成且用户正在编辑配置
- **THEN** 控制台 MUST 更新数据而保留配置视图与草稿
- **AND** MUST NOT 强制切回签到列表

#### Scenario: 任务完成时面板已经关闭
- **WHEN** 用户关闭面板后后台任务结束或进入重试
- **THEN** 状态与入口提醒 MUST 更新
- **AND** 控制台 MUST NOT 因该任务回调自动重新展开

#### Scenario: 重复刷新控制台
- **WHEN** 控制台持续收到状态更新
- **THEN** 页面样式与事件监听 MUST 不因刷新重复累积
- **AND** 已有输入框、操作焦点与滚动位置 MUST 保持稳定

### Requirement: 跨标签页同步与生命周期刷新

控制台 MUST 跟踪站点页面的状态变化，并在重新展开、切回可见页面及跨日时核对状态；同步不能受两分钟展示倒计时限制，且隐藏面板时不得进行无意义的高频重绘。

#### Scenario: 人工验证超过两分钟
- **WHEN** 用户在站点页超过两分钟后完成签到
- **THEN** 控制台面板和入口待办数 MUST 在接收到更新或重新可见时反映最新结果
- **AND** MUST NOT 要求用户手动刷新整页

#### Scenario: 管理器缺少状态监听能力
- **WHEN** 当前脚本管理器不能提供跨页面值变更监听
- **THEN** 脚本 MUST 使用有限的可见期检查与重新可见刷新降级
- **AND** MUST NOT 永久显示过期的执行中状态

### Requirement: 状态相关操作与手动标记恢复

目标行 MUST 优先显示适合当前状态的主要操作，手动成功、失败和跳过 MUST 作为明确的人工标记操作，并提供重置、重新检测及短时撤销；批量手动成功 MUST NOT 默认覆盖正在自动执行的目标。

#### Scenario: 目标需要用户登录
- **WHEN** 目标处于需登录状态
- **THEN** 主要操作 MUST 引导用户登录站点
- **AND** MUST NOT 把无意义的重复直签作为默认操作

#### Scenario: 用户修正错误标记
- **WHEN** 用户选择重置今日状态或撤销刚才的人工标记
- **THEN** 控制台 MUST 展示恢复结果并提供重新检测入口
- **AND** MUST 使用与站点引擎一致的恢复后状态

#### Scenario: 页面提示等待人工验证
- **WHEN** 站点页正在等待用户完成验证码
- **THEN** 页面状态提示 MUST 使用等待验证或需要操作等准确标题
- **AND** MUST NOT 统一显示为签到失败
