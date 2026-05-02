export const DECOMPOSITION_PROMPT = `
Decompose the following high-level goal into 1-3 specific research tasks.
Return ONLY valid JSON. No prose, no markdown fences.
Format: { "tasks": [{ "description": "...", "capability": "web-research" }] }

Goal:
`;

export const SYNTHESIS_PROMPT = `
You are a synthesis agent receiving multiple research results for a goal.
Produce a clear, structured final answer.
Cite which sub-result each finding came from.

Goal:
`;

export const BID_SELECTION_NOTE = "Bid selection: reputation score × 0.6 + price competitiveness × 0.4";
