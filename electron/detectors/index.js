/**
 * AI 工具检测器管理器
 * 自动加载 detectors 目录下所有检测器，提供统一的检测接口
 *
 * 新增检测器只需要在 detectors 目录下新建文件，导出符合规范的对象即可
 */

const fs = require('fs');
const path = require('path');

class DetectorManager {
  constructor() {
    this.detectors = [];
    this.loadDetectors();
  }

  /**
   * 自动加载 detectors 目录下所有检测器
   */
  loadDetectors() {
    const detectorsDir = __dirname;
    const files = fs.readdirSync(detectorsDir);

    for (const file of files) {
      if (file === 'index.js' || !file.endsWith('.js') || file.startsWith('.')) continue;

      try {
        const detector = require(path.join(detectorsDir, file));
        this.validateDetector(detector);
        this.detectors.push(detector);
        console.log(`✅ 加载检测器: ${detector.name}`);
      } catch (e) {
        console.error(`❌ 加载检测器失败: ${file}`, e.message);
      }
    }

    console.log(`\n📊 共加载 ${this.detectors.length} 个检测器\n`);
  }

  /**
   * 验证检测器是否符合规范
   */
  validateDetector(detector) {
    const required = ['id', 'name', 'detect'];
    const missing = required.filter(k => !detector[k]);

    if (missing.length > 0) {
      throw new Error(`缺少必要字段: ${missing.join(', ')}`);
    }

    if (typeof detector.detect !== 'function') {
      throw new Error('detect 必须是函数');
    }
  }

  /**
   * 运行所有检测器
   * @param {Object} context - 检测上下文
   * @param {Array} context.processes - ps 解析后的进程列表
   * @param {Object} context.detectorOptions - 各个检测器的配置
   * @returns {Promise<Object>} 检测结果
   */
  async detectAll(context = {}) {
    const results = [];
    let totalActive = 0;

    for (const detector of this.detectors) {
      try {
        const result = await detector.detect(context.processes || [], context);
        totalActive += result.activeCount || 0;
        results.push({
          id: detector.id,
          name: detector.name,
          ...result,
        });
      } catch (e) {
        console.error(`❌ 检测器 ${detector.name} 运行失败:`, e.message);
        results.push({
          id: detector.id,
          name: detector.name,
          activeCount: 0,
          error: e.message,
        });
      }
    }

    return {
      totalActive,
      results,
      isRunning: totalActive > 0,
    };
  }

  /**
   * 获取已加载的检测器列表
   */
  getDetectorList() {
    return this.detectors.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
    }));
  }
}

// 单例导出
module.exports = {
  detectorManager: new DetectorManager(),
  DetectorManager,
};
