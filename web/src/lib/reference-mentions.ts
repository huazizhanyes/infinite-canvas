export function normalizeReferenceMentions(prompt: string, labels: string[]) {
    const sortedLabels = Array.from(new Set(labels.filter(Boolean))).sort((left, right) => right.length - left.length);
    if (!sortedLabels.length || !prompt) return prompt;

    let result = "";
    let index = 0;
    while (index < prompt.length) {
        let label: string | undefined;
        const mentionStart = index;
        if (prompt[index] === "@") {
            label = sortedLabels.find((candidate) => prompt.startsWith(candidate, index + 1));
        } else if (index === 0 || prompt[index - 1] !== "@") {
            label = sortedLabels.find((candidate) => prompt.startsWith(candidate, index));
        }

        if (!label) {
            result += prompt[index];
            index += 1;
            continue;
        }

        result += `@${label}`;
        index = mentionStart + (prompt[mentionStart] === "@" ? 1 : 0) + label.length;
        const next = prompt[index];
        if (next && !/\s/.test(next) && !/[，。！？：；、,.!?;:()[\]{}【】「」『』<>《》@]/.test(next)) result += " ";
    }
    return result;
}
