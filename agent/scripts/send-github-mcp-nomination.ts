import { sendGitHubMcpNomination } from "../src/github-mcp-nomination.ts";

console.log(JSON.stringify(await sendGitHubMcpNomination(), null, 2));
