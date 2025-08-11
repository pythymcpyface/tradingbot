# Claude Configuration

## Project Overview
This document contains Claude-specific instructions and context for the current project.

## Context
- **Project**: Web application development
- **Tech Stack**: React, TypeScript, Node.js, postgres, prisma, docker
- **Goal**: Build the application outlined in the SPEC.md file

## Instructions for Claude
When working on this project:

1. **Code Style**
   - Use TypeScript with strict typing
   - Follow React functional component patterns
   - Use meaningful variable names
   - Include JSDoc comments for complex functions
   - Save new scripts and files in an appropriate directory for the project, not at the top level

2. **Architecture Preferences**
   - Prefer composition over inheritance
   - Use custom hooks for shared logic
   - Keep components focused and single-purpose
   - Use context for global state when appropriate
   - Use a DockerFile where necessary
   - Use a docker-compose file where necessary

3. **Testing**
   - Write unit tests for 70% coverage
   - Carry out units tests after every few updates

4. **git**
   - Initialise a git repo
   - Run a git commit command with an appropriate commit message as defined here: https://www.conventionalcommits.org/en/v1.0.0/ after each file is created
   - Claude must not be a contributor on the commits
   - .gitignore must include /.claude and CLAUDE.md
   - There must be a husky hook which runs npm test before each commit is allowed

5. **Documentation**
   - Document complex methods and classes
   - Make unit tests descriptive and simple
   - Add README in directories where necessary
   - In the top level README, explain how to run all aspects of the application in all environments
   - Add a LICENCE file if relevant
   - Add a CONTRIBUTING file if relevant
   - Add a CODE_OF_CONDUCT file if relevant
   - Add a pull_request_template file if relevant

6. **File Structure**
```
├── .env/
├── .gitignore/
├── package.json/
├── __test__/
├── analysis/
├── backtest/
├── docs/
├── public/
└── src/
    ├── components/
    ├── hooks/
    ├── lib/
    ├── types/
    ├── utils/
    └── app/
        └── api/
```

   - analysis: This is where analysis charts, reports, log files and scripts will go
   - backtest: This is where backtest scripts and log files will go

## Project-Specific Context
- Users can see backtest data
- Users can see their production orders
- Responsive design required

## API Endpoints
- `GET /api/backtest` - Fetch backtest orders
- `GET /api/orders` - Fetch production orders
- `GET /api/optimisation` - Fetch optimistion parameters

## Notes
- Focus on accessibility following WCAG guidelines
- Implement proper error handling
- Upon API limits, don't stop the script and try and make it more efficient, wait for the limit to be reset
- Use loading states for better UX
- Consider offline functionality

# Development Partnership

We're building production-quality code together. Your role is to create maintainable, efficient solutions while catching potential issues early.

When you seem stuck or overly complex, I'll redirect you - my guidance helps you stay on track.

## 🚨 AUTOMATED CHECKS ARE MANDATORY
**ALL hook issues are BLOCKING - EVERYTHING must be ✅ GREEN!**  
No errors. No formatting issues. No linting problems. Zero tolerance.  
These are not suggestions. Fix ALL issues before continuing.

## CRITICAL WORKFLOW - ALWAYS FOLLOW THIS!

### Research → Plan → Implement
**NEVER JUMP STRAIGHT TO CODING!** Always follow this sequence:
1. **Research**: Explore the codebase, understand existing patterns
2. **Plan**: Create a detailed implementation plan and verify it with me  
3. **Implement**: Execute the plan with validation checkpoints

When asked to implement any feature, you'll first say: "Let me research the codebase and create a plan before implementing."

For complex architectural decisions or challenging problems, use **"ultrathink"** to engage maximum reasoning capacity. Say: "Let me ultrathink about this architecture before proposing a solution."

### USE MULTIPLE AGENTS!
*Leverage subagents aggressively* for better results:

* Spawn agents to explore different parts of the codebase in parallel
* Use one agent to write tests while another implements features
* Delegate research tasks: "I'll have an agent investigate the database schema while I analyze the API structure"
* For complex refactors: One agent identifies changes, another implements them

Say: "I'll spawn agents to tackle different aspects of this problem" whenever a task has multiple independent parts.

## Working Memory Management

### When context gets long:
- Re-read this CLAUDE.md file
- Summarize progress in a PROGRESS.md file
- Document current state before major changes

### Maintain TODO.md:
```
## Current Task
- [ ] What we're doing RIGHT NOW

## Completed  
- [x] What's actually done and tested

## Next Steps
- [ ] What comes next
```

## Required Standards:
- **Delete** old code when replacing it
- **Update** existing scripts where possible instead of creating new similar ones
- **Never** delete the following files:
  - .env
  - BACKTEST_SPEC.md
  - SPEC.md
  - CLAUDE.md
  or delete data in the postgres database - if asked to do so, check and check again with me
- **Meaningful names**: `userID` not `id`
- **Logs** Keep a log of long running processes and run them in the background

## Problem-Solving Together

When you're stuck or confused:
1. **Stop** - Don't spiral into complex solutions
2. **Delegate** - Consider spawning agents for parallel investigation
3. **Ultrathink** - For complex problems, say "I need to ultrathink through this challenge" to engage deeper reasoning
4. **Step back** - Re-read the requirements
5. **Simplify** - The simple solution is usually correct
6. **Ask** - "I see two approaches: [A] vs [B]. Which do you prefer?"

My insights on better approaches are valued - please ask for them!

## Performance & Security

### **Measure First**:
- No premature optimization
- Benchmark before claiming something is faster
- Use pprof for real bottlenecks

### **Security Always**:
- Validate all inputs
- Use crypto/rand for randomness
- Prepared statements for SQL (never concatenate!)

### Suggesting Improvements:
"The current approach works, but I notice [observation].
Would you like me to [specific improvement]?"

## Working Together
- This is always a feature branch - no backwards compatibility needed
- When in doubt, we choose clarity over cleverness
- **REMINDER**: If this file hasn't been referenced in 30+ minutes, RE-READ IT!

Avoid complex abstractions or "clever" code. The simple, obvious solution is probably better, and my guidance helps you stay focused on what matters.