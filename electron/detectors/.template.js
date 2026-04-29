/**
 * 新检测器模板 - 复制此文件，修改以下配置即可
 * 使用方式:
 * 1. cp template.js your-tool.js
 * 2. 修改 id, name, description
 * 3. 实现 detect 函数
 * 4. 重启应用生效
 */

/**
 * 工具特定的检测逻辑
 */
function checkActivity(processes) {
  // TODO: 实现你的检测逻辑
  // 可以检查进程状态、子进程、日志文件、网络连接等
  return false;
}

module.exports = {
  // 唯一标识 (必填)
  id: 'your-tool-id',

  // 显示名称 (必填)
  name: '你的 AI 工具名称',

  // 描述 (可选)
  description: '检测 XXX 工具的 AI 活跃状态',

  /**
   * 检测函数 (必填)
   * @param {Array} processes - ps 命令解析出的所有进程列表
   * @param {Object} context - 检测上下文
   * @returns {Object} 检测结果
   *  {
   *    activeCount: Number,  // 活跃实例数，0=不活跃，1+表示活跃
   *    message?: String,     // 额外信息说明
   *    ... 其他自定义字段
   *  }
   */
  async detect(processes, context) {
    // TODO: 实现检测逻辑
    // 示例:
    // const myProcesses = processes.filter(p =>
    //   p.commandLower.includes('your-tool')
    // );
    //
    // const isActive = myProcesses.some(p =>
    //   p.stat === 'R' || checkChildren(p, processes)
    // );
    //
    // return {
    //   activeCount: isActive ? 1 : 0,
    //   message: `检测到 ${myProcesses.length} 个实例`,
    // };

    return {
      activeCount: 0,
      message: '模板检测器 - 未实现',
    };
  },
};
