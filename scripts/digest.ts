// scripts/digest.ts
// 专为 FPGA / 数字 IC 验证工程师定制的 AI 每日资讯精选 (融合原版兼容性终极版)

const RSS_FEEDS = [
  "https://zipcpu.com/feed.xml",
  "https://www.verilogpro.com/feed/",
  "https://hackaday.com/category/fpga/feed/",
  "https://tomverbeure.github.io/atom.xml",
  "https://itsembedded.com/index.xml",
  "https://semiengineering.com/feed/"
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
// 命令行参数解析
// ----------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { hours: 48, topN: 15, lang: "zh", output: "./fpga-digest.md" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hours") config.hours = parseInt(args[++i], 10);
    if (args[i] === "--top-n") config.topN = parseInt(args[++i], 10);
    if (args[i] === "--lang") config.lang = args[++i];
    if (args[i] === "--output") config.output = args[++i];
  }
  return config;
}

// ----------------------------------------------------------------------
// JSON 提取 (引入原版的高级去壳逻辑)
// ----------------------------------------------------------------------
function parseJsonResponse(text: string) {
  let jsonText = text.trim();
  // 像原版一样剥离 Markdown 代码块
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  // 加上正则提取大括号的最后防线
  const match = jsonText.match(/\{[\s\S]*\}/);
  const cleanJson = match ? match[0] : jsonText;
  return JSON.parse(cleanJson);
}

// ----------------------------------------------------------------------
// AI 接口调用 (引入原版的 Moonshot 判断)
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

  // 🚨 核心修复：如果是 Kimi (Moonshot)，绝对不要传 temperature
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
// RSS 抓取与解析 (极简正则版)
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
    console.log(`⚠️ 抓取失败: ${url}`);
    return [];
  }
}

// ----------------------------------------------------------------------
// 核心工作流
// ----------------------------------------------------------------------
async function main() {
  const config = parseArgs();
  console.log(`🚀 启动 FPGA 验证日报生成器 | 时间范围: ${config.hours}h | 数量: ${config.topN}`);
  
  const cutoffDate = new Date(Date.now() - config.hours * 60 * 60 * 1000);
  
  // 1. 并发抓取 RSS
  console.log("📡 正在抓取资讯源...");
  const fetchPromises = RSS_FEEDS.map(url => fetchRSS(url, cutoffDate));
  const results = await Promise.all(fetchPromises);
  const allArticles = results.flat();
  console.log(`✅ 共抓取到 ${allArticles.length} 篇近期文章。`);

  if (allArticles.length === 0) {
    console.log("没有找到新文章，退出。");
    return;
  }

  // 2. AI 评分与分类
  console.log("🤖 正在进行 AI 维度评估与打分...");
  const scoredArticles: ScoredArticle[] = [];
  
  for (const article of allArticles) {
    const prompt = `你是一个资深的数字IC与FPGA验证专家。请评估以下文章：
标题：${article.title}
来源：${article.source}

请从相关性、质量、时效性三个维度打分(1-10)。并归入以下分类之一：
[🛠️ 验证方法学, 💻 RTL与架构设计, ⚙️ EDA工具 & 开源生态, 🚀 行业动态 & 趋势, 📝 其他硬件杂谈]

必须严格返回 JSON：
{"score": 8, "category": "分类名", "keywords": ["关键词1", "关键词2"], "reason": "一句话理由"}`;

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
    console.log("所有文章评分均失败，请检查 API 配置，退出。");
    return;
  }

  // 3. 排序并提取 Top N
  scoredArticles.sort((a, b) => b.score - a.score);
  const topArticles = scoredArticles.slice(0, config.topN);

  // 4. AI 生成摘要与翻译
  console.log("📝 正在为 Top 推荐生成结构化摘要...");
  for (const article of topArticles) {
    const prompt = `你是一个资深的数字IC/FPGA验证架构师。请为以下文章生成摘要：
标题：${article.title}

要求：
1. 用 4-6 句话概括核心内容，指出核心痛点和解决方案。
2. 翻译标题为中文。
3. 给出推荐给验证工程师的理由。

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

  // 5. 趋势总结
  console.log("📈 正在提炼今日验证技术趋势...");
  const titlesForTrend = topArticles.map(a => `- ${a.title} (${a.category})`).join("\n");
  const trendPrompt = `作为硬件验证专家，请根据今天的高分文章列表总结 2-3 个技术趋势，4-5句话，语言专业硬核：\n${titlesForTrend}`;
  let trendSummary = "暂无趋势总结。";
  try {
    trendSummary = await callAI(trendPrompt);
  } catch (e: any) {
    console.log(`\n[趋势报错] -> ${e.message}`);
  }

  // 6. 渲染 Markdown 日报
  console.log("📄 正在生成 Markdown 报告...");
  
  let md = `# 🛠️ FPGA / 验证技术每日精选\n\n`;
  md += `> 生成时间：${new Date().toLocaleString()} | 数据范围：过去 ${config.hours} 小时\n\n`;
  
  md += `## 📝 今日看点\n\n${trendSummary}\n\n`;
  md += `---\n\n`;
  
  md += `## 🏆 今日必读 (Top 3)\n\n`;
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
  
  md += "```mermaid\npie title 今日文章分类占比\n";
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

  // 写入文件
  await Bun.write(config.output, md);
  console.log(`🎉 运行完毕！日报已保存至: ${config.output}`);
}

main().catch(console.error);
