#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  
  let planPath = null;
  let outDir = null;
  let now = null;
  
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    
    if (flag === '--plan') {
      planPath = value;
    } else if (flag === '--out-dir') {
      outDir = value;
    } else if (flag === '--now') {
      now = value;
    }
  }
  
  if (!planPath || !outDir || !now) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_ARGS',
      message: 'Missing required arguments: --plan, --out-dir, --now',
      details: { planPath, outDir, now }
    }, null, 2));
    process.exit(2);
  }
  
  let plan;
  try {
    const planContent = fs.readFileSync(planPath, 'utf-8');
    plan = JSON.parse(planContent);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_PLAN',
      message: 'Failed to read or parse plan file',
      details: { error: err.message }
    }, null, 2));
    process.exit(2);
  }
  
  if (!plan.run_id || !plan.phase_id || !plan.repo_root || !plan.prompt) {
    console.log(JSON.stringify({
      ok: false,
      code: 'INVALID_PLAN',
      message: 'Plan missing required fields: run_id, phase_id, repo_root, prompt',
      details: { plan }
    }, null, 2));
    process.exit(2);
  }
  
  fs.mkdirSync(outDir, { recursive: true });
  
  const receipt = {
    ok: true,
    now: now,
    run_id: plan.run_id,
    phase_id: plan.phase_id,
    repo_root: plan.repo_root,
    prompt: plan.prompt,
    status: 'READY_FOR_EXECUTOR',
    next_phase_id: plan.next_phase_id || null,
    paths: {
      plan: planPath,
      receipt: path.join(outDir, `${plan.run_id}.${plan.phase_id}.json`)
    }
  };
  
  const receiptPath = path.join(outDir, `${plan.run_id}.${plan.phase_id}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  
  console.log(JSON.stringify(receipt, null, 2));
}

main();
