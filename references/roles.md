# Capability-Based Role Assignment

Score each available agent for each role from 0 to 3: 3 means direct tool and repeated evidence; 2 plausible with evidence; 1 indirect or unverified; 0 unavailable or forbidden.

Choose the highest score, then prefer lower cost and lower contention. Break ties by availability and prior evidence, never arbitrary order.

| Work | Preferred role | Evidence |
| requirements | coordinator | task packet |
| code or file changes | implementer | diff and changed-file list |
| runtime or API checks | verifier | reproducible output |
| build or MCP failures | environment specialist | diagnostic and scoped fix |
| UX/content/security/domain | domain reviewer | criteria-linked findings |

One primary writer per file/resource. Reviewers write only isolated artifacts unless a recorded handoff promotes them. A handoff records old owner, new owner, reason, baseline, and next check.
