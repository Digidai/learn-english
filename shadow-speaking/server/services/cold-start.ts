export interface ColdStartPack {
  id: string;
  name: string;
  description: string;
  sentences: Array<{
    content: string;
    level: number;
    tags: string[];
  }>;
}

export const COLD_START_PACKS: ColdStartPack[] = [
  {
    id: "daily",
    name: "日常对话",
    description: "问候、天气、兴趣爱好等日常交流",
    sentences: [
      { content: "How are you doing today?", level: 1, tags: ["日常对话", "问候"] },
      { content: "Nice to meet you.", level: 1, tags: ["日常对话", "问候"] },
      { content: "What do you do for fun?", level: 1, tags: ["日常对话", "兴趣"] },
      { content: "I really enjoy reading books in my free time.", level: 2, tags: ["日常对话", "兴趣"] },
      { content: "The weather is really nice today, isn't it?", level: 2, tags: ["日常对话", "天气"] },
      { content: "I've been meaning to try that new restaurant downtown.", level: 2, tags: ["日常对话", "美食"] },
      { content: "Could you recommend a good movie to watch this weekend?", level: 2, tags: ["日常对话", "娱乐"] },
      { content: "I usually wake up around seven and go for a morning jog.", level: 2, tags: ["日常对话", "生活"] },
      { content: "It's been a while since we last caught up. How have you been?", level: 3, tags: ["日常对话", "问候"] },
      { content: "I'm thinking about picking up a new hobby, maybe photography or cooking.", level: 3, tags: ["日常对话", "兴趣"] },
      { content: "The traffic was absolutely terrible this morning, it took me twice as long to get here.", level: 3, tags: ["日常对话", "通勤"] },
      { content: "I'd love to travel more, but it's hard to find the time with work and everything.", level: 3, tags: ["日常对话", "旅行"] },
    ],
  },
  {
    id: "business",
    name: "职场英语",
    description: "会议、邮件、工作汇报等职场场景",
    sentences: [
      { content: "Let's get started.", level: 1, tags: ["职场", "会议"] },
      { content: "I'll send you an email about it.", level: 2, tags: ["职场", "邮件"] },
      { content: "Could we schedule a meeting for next week?", level: 2, tags: ["职场", "会议"] },
      { content: "I'd like to give you a quick update on the project.", level: 2, tags: ["职场", "汇报"] },
      { content: "Let me walk you through the main points of the proposal.", level: 2, tags: ["职场", "演示"] },
      { content: "I think we should prioritize the most urgent tasks first.", level: 3, tags: ["职场", "管理"] },
      { content: "The deadline has been pushed back to next Friday, so we have a bit more time.", level: 3, tags: ["职场", "项目"] },
      { content: "I appreciate your feedback, and I'll make the necessary changes by tomorrow.", level: 3, tags: ["职场", "沟通"] },
      { content: "Based on the data we've collected, I recommend we take a different approach.", level: 3, tags: ["职场", "决策"] },
      { content: "Could you elaborate on that point? I want to make sure I understand correctly.", level: 3, tags: ["职场", "会议"] },
      { content: "We need to align our team's goals with the overall company strategy for this quarter.", level: 4, tags: ["职场", "战略"] },
      { content: "I'd like to propose a new workflow that could improve our team's efficiency by at least twenty percent.", level: 4, tags: ["职场", "改进"] },
    ],
  },
  {
    id: "travel",
    name: "旅行出行",
    description: "问路、点餐、住宿、机场等出行场景",
    sentences: [
      { content: "Excuse me, where is the bathroom?", level: 1, tags: ["旅行", "问路"] },
      { content: "How much does this cost?", level: 1, tags: ["旅行", "购物"] },
      { content: "Could you help me find my way to the train station?", level: 2, tags: ["旅行", "问路"] },
      { content: "I'd like to check in, please. I have a reservation.", level: 2, tags: ["旅行", "住宿"] },
      { content: "Can I have the menu, please? I'm not sure what to order.", level: 2, tags: ["旅行", "餐厅"] },
      { content: "Is there a pharmacy nearby? I need to buy some medicine.", level: 2, tags: ["旅行", "生活"] },
      { content: "I'd like a window seat if possible, and could I get a vegetarian meal?", level: 3, tags: ["旅行", "机场"] },
      { content: "My flight has been delayed. Could you help me rebook for the next available one?", level: 3, tags: ["旅行", "机场"] },
      { content: "We're looking for a restaurant that serves local cuisine. Any recommendations?", level: 3, tags: ["旅行", "美食"] },
      { content: "I think there might be a mistake on my bill. Could you double-check it for me?", level: 3, tags: ["旅行", "住宿"] },
    ],
  },
  {
    id: "introduction",
    name: "自我介绍",
    description: "个人背景、职业经历、兴趣特长",
    sentences: [
      { content: "My name is... and I'm from China.", level: 1, tags: ["自我介绍", "基本信息"] },
      { content: "I work as a software engineer.", level: 1, tags: ["自我介绍", "职业"] },
      { content: "I've been living in this city for about three years now.", level: 2, tags: ["自我介绍", "基本信息"] },
      { content: "In my spare time, I enjoy playing basketball and reading novels.", level: 2, tags: ["自我介绍", "兴趣"] },
      { content: "I majored in computer science at university and graduated in twenty twenty.", level: 3, tags: ["自我介绍", "教育"] },
      { content: "I'm currently working on improving my English speaking skills because I want to communicate more effectively at work.", level: 3, tags: ["自我介绍", "目标"] },
      { content: "Before joining my current company, I spent two years working at a startup where I learned a lot about product development.", level: 4, tags: ["自我介绍", "经历"] },
      { content: "One of my proudest achievements was leading a team project that increased our department's productivity by thirty percent.", level: 4, tags: ["自我介绍", "成就"] },
    ],
  },
];

export interface ColdStartImportResult {
  count: number;
  materialIds: string[];
  sentences: string[];
}

export async function importColdStartPack(
  db: D1Database,
  userId: string,
  packId: string
): Promise<ColdStartImportResult> {
  const pack = COLD_START_PACKS.find((p) => p.id === packId);
  if (!pack) return { count: 0, materialIds: [], sentences: [] };

  // Batch check for duplicates
  const dupChecks = pack.sentences.map((s) =>
    db
      .prepare("SELECT id FROM materials WHERE user_id = ? AND content = ?")
      .bind(userId, s.content)
  );
  const dupResults = await db.batch(dupChecks);

  // Filter to non-duplicate sentences, guarding batch result access
  const toImport = pack.sentences.filter(
    (_, i) => !dupResults[i]?.results || dupResults[i].results.length === 0
  );

  if (toImport.length === 0) return { count: 0, materialIds: [], sentences: [] };

  // Generate IDs upfront so we can return them
  const materialIds = toImport.map(() => crypto.randomUUID());

  // Batch insert all new materials
  const insertStatements = toImport.map((sentence, i) =>
    db
      .prepare(
        `INSERT INTO materials (id, user_id, content, source_type, level, tags, preprocess_status)
         VALUES (?, ?, ?, 'cold_start', ?, ?, 'pending')`
      )
      .bind(materialIds[i], userId, sentence.content, sentence.level, JSON.stringify(sentence.tags))
  );

  await db.batch(insertStatements);

  return {
    count: toImport.length,
    materialIds,
    sentences: toImport.map((s) => s.content),
  };
}
