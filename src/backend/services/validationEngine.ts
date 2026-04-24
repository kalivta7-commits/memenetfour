// Rejected phrases per prompt
const BLOCKED_TERMS = [
  'rug pull', 'rug', 'scam', 'fraud', 'hack', 'stolen',
  'buy now', 'sell now', 'go all in', 'not financial advice',
  'guaranteed', '100x', 'will moon', 'easy money',
  'slur', 'hate speech', 'threat'
];

export const validationEngine = {
  passes(content: string): boolean {
    if (!content || content.length < 10 || content.length > 300) {
      return false;
    }
    
    // Check against blocked terms
    const lowerContent = content.toLowerCase();
    for (const term of BLOCKED_TERMS) {
      if (lowerContent.includes(term.toLowerCase())) {
        return false;
      }
    }
    
    // Future duplicate checks or generic filler checks could go here
    return true;
  }
};
