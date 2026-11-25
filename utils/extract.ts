export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ExtractedNote {
  title: string;
  summary: string;
  tags: string[];
  actionItems: ActionItem[];
}

const TAG_RULES: [RegExp, string][] = [
  [/\b(bug|fix|error|crash|broken|issue|debug)\b/i, 'bug'],
  [/\b(ship|deploy|release|build|launch|pr|commit)\b/i, 'ship'],
  [/\b(idea|maybe|could|what if|concept|explore)\b/i, 'idea'],
  [/\b(meet|call|sync|talk|email|ping|interview)\b/i, 'people'],
  [/\b(todo|need to|must|remember|don't forget|tomorrow)\b/i, 'todo'],
  [/\b(learn|read|study|paper|watch)\b/i, 'study'],
];

const ACTION_PREFIX = /^(?:todo|need to|must|remember to|gotta|have to|will|next)\b[:\s-]*/i;

export function extractStructuredNote(rawText: string): ExtractedNote {
  const cleaned = rawText.trim().replace(/\s+/g, ' ');
  const sentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const first = sentences[0] || cleaned;
  const words = first.split(' ');
  const title = words.length > 7 ? `${words.slice(0, 7).join(' ')}...` : first;
  const summary = sentences.slice(0, 2).join(' ');

  const tags = new Set<string>();
  for (const [pattern, label] of TAG_RULES) {
    if (pattern.test(cleaned)) {
      tags.add(label);
    }
  }
  if (tags.size === 0) {
    tags.add('log');
  }

  const actionItems: ActionItem[] = [];
  sentences.forEach((sentence, idx) => {
    if (ACTION_PREFIX.test(sentence) || /\b(need to|have to|should|must|todo)\b/i.test(sentence)) {
      const normalized = sentence.replace(ACTION_PREFIX, '').trim();
      if (normalized) {
        actionItems.push({
          id: `act-${Date.now()}-${idx}`,
          text: normalized,
          done: false,
        });
      }
    }
  });

  return {
    title,
    summary,
    tags: Array.from(tags).slice(0, 4),
    actionItems: actionItems.slice(0, 5),
  };
}
