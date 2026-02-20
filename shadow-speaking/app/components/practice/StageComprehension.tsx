interface Props {
  content: string;
  translation: string | null;
  phoneticNotes: Array<{ original: string; pronunciation: string; type: string }>;
  isReview: boolean;
  onComplete: () => void;
}

export function StageComprehension({
  content,
  translation,
  phoneticNotes,
  isReview,
  onComplete,
}: Props) {
  if (isReview) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full mb-4">
            阶段一 · 理解
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-xl font-medium text-gray-900 leading-relaxed">
            {content}
          </p>
          <p className="text-sm text-gray-400 mt-3">{translation}</p>
        </div>

        <button
          onClick={onComplete}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
        >
          记得，继续
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full mb-4">
          阶段一 · 理解
        </h2>
        <p className="text-sm text-gray-500">先理解这句话的含义，再开始跟读</p>
      </div>

      {/* English text */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {content}
        </p>
      </div>

      {/* Chinese translation */}
      {translation && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">中文释义</p>
          <p className="text-gray-700">{translation}</p>
        </div>
      )}

      {/* Phonetic notes */}
      {phoneticNotes.length > 0 && (
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-xs text-amber-600 font-medium mb-2">语音现象</p>
          <div className="space-y-2">
            {phoneticNotes.map((note, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">{note.original}</span>
                <span className="text-gray-400">→</span>
                <span className="text-amber-700 font-medium">{note.pronunciation}</span>
                <span className="text-xs text-gray-400 px-1.5 py-0.5 bg-white rounded">
                  {note.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onComplete}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
      >
        已理解，下一步
      </button>
    </div>
  );
}
