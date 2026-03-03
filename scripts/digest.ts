// scripts/digest.ts
// 专为数字 IC 与 FPGA 验证工程师定制的 AI 资讯精选 (增强源 & 常青评分版)

const RSS_FEEDS = [
  // --- 经典硬件与架构源 ---
  "https://zipcpu.com/feed.xml",
  "https://www.verilogpro.com/feed/",
  "https://hackaday.com/category/fpga/feed/",
  "https://tomverbeure.github.io/atom.xml",
  "https://itsembedded.com/index.xml",
  
  // --- 行业与 EDA 厂商大号 ---
  "https://semiengineering.com/feed/",
  "https://semiwiki.com/feed/",
  "https://verificationacademy.com/blog/feed/",
  "https://www.synopsys.com/blogs/rss.xml",
  "https://www.eejournal.com/feed/",
  "https://www.xilinx.com/blogs/rss.xml",
  "https://www.intel.com/content/www/us/en/programmable/support/rss.html",

  // --- 🌟 新增：顶级硬核与验证方法学源 ---
  "https://www.amiq.com/consulting/blog/feed/", // AMIQ：极客级 UVM/SV 验证技巧和开源工具
  "https://blogs.sw.siemens.com/verificationhorizons/feed/", // 西门子(Mentor) 验证视界
  "https://chipsandcheese.com/feed/", // 极其硬核的底层芯片微架构与性能分析
  "https://agilesoc.com/feed/", // 探讨敏捷开发在硬件设计和验证中的应用
  "https://vhdlwhiz.com/feed/", // VHDL 与通用 FPGA 仿真测试思路
  "https://www.adiuvoengineering.com/blog-feed.xml" // Adam Taylor 的 FPGA 开发实战博客
];

// 接口定义
interface Article {
  title: string;
  link: string;
  pubDate: Date;
  source: string;
}

interface ScoredArticle extends Article {
  score: number;
  category: string;
  keywords: string[];
  reason: string;
  zh_title?: string;
  summary?: string;
  recommend_reason?: string;
}

// ----------------------------------------------------------------------
// 时间辅助函数 (UTC+8)
// ----------------------------------------------------------------------
function toUTC8String(date: Date): string {
  // 加上 8 小时的毫秒数 (8 * 60 * 60 * 1000 = 28800000)
  return new Date(date.getTime() + 28800000).toISOString();
}

// ----------------------------------------------------------------------
// 命令行参数解析
// ----------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { hours: 168, topN: 15, lang: "zh", output: "" }; // 默认改为抓取 168 小时 (7天)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hours") config.hours = parseInt(args[++i], 10);
    if (args[i] === "--top-n") config.topN = parseInt(args[++i], 10);
    if (args[i] === "--lang") config.lang = args[++i];
    if (args[i] === "--output") config.output = args[++i];
  }
  
  if (!config.output) {
    const dateStr = toUTC8String(new Date()).slice(0, 10).replace(/-/g, '');
    config.output = `./fpga-digest-${dateStr}.md`;
  }
  
  return config;
}

// ----------------------------------------------------------------------
// JSON 提取防抖
// ----------------------------------------------------------------------
function parseJsonResponse(text: string) {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const match = jsonText.match(/\{[\s\S]*\}/);
  const cleanJson = match ? match[0] : jsonText;
  return JSON.parse(cleanJson);
}

// ----------------------------------------------------------------------
// AI 接口调用
// ----------------------------------------------------------------------
async function callAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const apiBase = (process.env.OPENAI_API_BASE || "[https://api.openai.com/v1](https://api.openai.com/v1)").replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";

  if (!apiKey) throw new Error("缺少 API Key 环境变量");

  const isMoonshot = apiBase.includes('moonshot');
  
  const body: any = {
    model: model,
    messages: [{ role: "user", content: prompt }]
  };

  if (!isMoonshot) {
    body.temperature = 0.3;
  }

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ----------------------------------------------------------------------
// RSS 抓取与解析
// ----------------------------------------------------------------------
async function fetchRSS(url: string, cutoffDate: Date): Promise<Article[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); 
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!res.ok) return [];
    const text = await res.text();
    
    const articles: Article[] = [];
    const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const itemHtml = match[1];
      const titleMatch = itemHtml.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/) || itemHtml.match(/<title[^>]*>(.*?)<\/title>/);
      let linkMatch = itemHtml.match(/<link[^>]*href=["'](.*?)["']/);
      if (!linkMatch) linkMatch = itemHtml.match(/<link>(.*?)<\/link>/);
      const dateMatch = itemHtml.match(/<pubDate>(.*?)<\/pubDate>/) || itemHtml.match(/<updated>(.*?)<\/updated>/) || itemHtml.match(/<published>(.*?)<\/published>/);
      
      if (titleMatch && linkMatch && dateMatch) {
        const pubDate = new Date(dateMatch[1]);
        if (pubDate >= cutoffDate) {
          const sourceMatch = url.match(/https?:\/\/(?:www\.)?([^\/]+)/);
          articles.push({
            title: titleMatch[1].trim(),
            link: linkMatch[1].trim(),
            pubDate,
            source: sourceMatch ? sourceMatch[1] : "Unknown"
          });
        }
      }
    }
    return articles;
  } catch (e) {
    console.log(`⚠️ 抓取失败/超时: ${url}`);
    return [];
  }
}

// ----------------------------------------------------------------------
// 核心工作流
// ----------------------------------------------------------------------
async function main() {
  const config = parseArgs();
  console.log(`🚀 启动 FPGA/IC 验证资讯精选 | 时间范围: ${config.hours}h | 数量: ${config.topN}`);
  
  const cutoffDate = new Date(Date.now() - config.hours * 60 * 60 * 1000);
  
  console.log("📡 正在抓取资讯源...");
  const fetchPromises = RSS_FEEDS.map(url => fetchRSS(url, cutoffDate));
  const results = await Promise.all(fetchPromises);
  const allArticles = results.flat();
  console.log(`✅ 共抓取到 ${allArticles.length} 篇近期文章。`);

  if (allArticles.length === 0) {
    console.log("没有找到新文章，大概率是时间窗口内大家都在写代码没空发博客，退出。");
    return;
  }

  console.log("🤖 正在进行 AI 深度维度评估与打分...");
  const scoredArticles: ScoredArticle[] = [];
  
  for (const article of allArticles) {
    // 🌟 重新设计的评分 Prompt：弱化时效，强调验证与原型落地
    const prompt = `你是一个资深的数字IC与FPGA验证专家。请评估以下文章：
标题：${article.title}
来源：${article.source}

硬件技术文章通常具有长效价值。请弱化纯新闻时效性的影响，重点从以下三个维度进行综合打分(总分1-10的整数)：
1. 技术与架构深度：是否涉及深层微架构、跨时钟域(CDC)、FPGA原型验证(Prototyping)或复杂系统级验证。
2. 验证方法学：是否涉及高级UVM技巧、SystemVerilog最佳实践、覆盖率收敛或调试(Debug)效率提升。
3. 工程落地价值：是否包含具体的代码示例、波形分析、架构图或真实的踩坑经验。

请归入以下分类之一：
[🛠️ 验证方法学与UVM, 💻 RTL与微架构设计, 🔬 FPGA原型与系统验证, ⚙️ EDA工具与生态, 📝 硬件实战与其他]

必须严格按以下 JSON 格式返回：
{"score": 8, "category": "分类名", "keywords": ["关键词1", "关键词2"], "reason": "一句话推荐理由，突出对日常验证工作的工程价值"}`;

    try {
      const respText = await callAI(prompt);
      const aiResult = parseJsonResponse(respText);
      scoredArticles.push({ ...article, ...aiResult });
      process.stdout.write(".");
    } catch (e: any) {
      console.log(`\n[评分报错] ${article.title.substring(0, 20)}... -> ${e.message}`);
    }
  }
  console.log("\n✅ 评分完成。");

  if (scoredArticles.length === 0) {
    console.log("所有文章评分均失败，退出。");
    return;
  }

  scoredArticles.sort((a, b) => b.score - a.score);
  const topArticles = scoredArticles.slice(0, config.topN);

  console.log("📝 正在为 Top 推荐生成结构化摘要...");
  for (const article of topArticles) {
    const prompt = `你是一个资深的数字IC/FPGA验证架构师。请为以下文章生成摘要：
标题：${article.title}

要求：
1. 用 4-6 句话概括核心内容，指出文章解决的具体验证痛点或架构设计问题。
2. 翻译标题为中文。
3. 给出推荐给验证团队的理由。

必须严格返回 JSON：
{"zh_title": "中文标题", "summary": "摘要内容", "recommend_reason": "推荐理由"}`;

    try {
      const respText = await callAI(prompt);
      const aiResult = parseJsonResponse(respText);
      article.zh_title = aiResult.zh_title;
      article.summary = aiResult.summary;
      article.recommend_reason = aiResult.recommend_reason;
      process.stdout.write(".");
    } catch (e: any) {
      article.zh_title = article.title;
      article.summary = "摘要生成失败。";
      article.recommend_reason = "";
      console.log(`\n[摘要报错] ${article.title.substring(0, 20)}... -> ${e.message}`);
    }
  }
  console.log("\n✅ 摘要生成完成。");

  console.log("📈 正在提炼技术趋势...");
  const titlesForTrend = topArticles.map(a => `- ${a.title} (${a.category})`).join("\n");
  const trendPrompt = `作为硬件验证专家，请根据今天的高分文章列表总结 2-3 个技术趋势，4-5句话，语言专业硬核：\n${titlesForTrend}`;
  let trendSummary = "暂无趋势总结。";
  try {
    trendSummary = await callAI(trendPrompt);
  } catch (e: any) {
    console.log(`\n[趋势报错] -> ${e.message}`);
  }

  console.log("📄 正在生成 Markdown 报告...");
  
  let md = `# 🛠️ FPGA / 验证技术精选\n\n`;
  
  const nowUTC8Str = toUTC8String(new Date());
  const formattedTime = nowUTC8Str.replace('T', ' ').slice(0, 19);
  md += `> 生成时间：${formattedTime} | 数据范围：过去 ${config.hours} 小时\n\n`;
  
  md += `## 📝 行业视点\n\n${trendSummary}\n\n`;
  md += `---\n\n`;
  
  md += `## 🏆 深度必读 (Top 3)\n\n`;
  const top3 = topArticles.slice(0, 3);
  top3.forEach((a, i) => {
    md += `### ${i+1}. [${a.zh_title || a.title}](${a.link})\n`;
    md += `**评分**: ${a.score}/10 | **分类**: ${a.category} | **标签**: ${(a.keywords || []).map(k=>`\`${k}\``).join(' ')}\n\n`;
    md += `> **💡 推荐理由**：${a.recommend_reason || '无'}\n\n`;
    md += `**摘要**：\n${a.summary}\n\n`;
  });
  
  md += `---\n\n`;
  md += `## 📊 资讯分布与高频标签\n\n`;
  
  const catCount = topArticles.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  md += "```mermaid\npie title 文章分类占比\n";
  for (const [cat, count] of Object.entries(catCount)) {
    md += `  "${cat}" : ${count}\n`;
  }
  md += "```\n\n";

  md += `## 📋 更多分类好文\n\n`;
  const restArticles = topArticles.slice(3);
  const grouped = restArticles.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {} as Record<string, ScoredArticle[]>);

  for (const [cat, articles] of Object.entries(grouped)) {
    md += `### ${cat}\n\n`;
    articles.forEach(a => {
      md += `- [**${a.zh_title || a.title}**](${a.link}) - *${a.source}* (${a.score}分)\n`;
      md += `  > ${a.summary}\n\n`;
    });
  }

  await Bun.write(config.output, md);
  console.log(`🎉 运行完毕！报告已保存至: ${config.output}`);
}

main().catch(console.error);
