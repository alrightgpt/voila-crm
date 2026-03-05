#!/usr/bin/env node
const fs=require('fs');
function err(code,msg,details){
console.log(JSON.stringify({ok:false,code,message:msg,details},null,2));
process.exit(2);
}
function main(){
const a=process.argv.slice(2);
let runId=null,phaseId=null,phaseIdx=null,nextPhaseId=null,promptFile=null,repoRoot=null;
for(let i=0;i<a.length;i++){
const f=a[i];
if(f==='--run-id')runId=a[++i];
else if(f==='--phase-id')phaseId=a[++i];
else if(f==='--phase-index'){phaseIdx=parseInt(a[++i],10);if(isNaN(phaseIdx)||phaseIdx<1)err('INVALID_ARGS','Invalid phase-index');}
else if(f==='--next-phase-id')nextPhaseId=a[++i];
else if(f==='--prompt-file')promptFile=a[++i];
else if(f==='--repo-root')repoRoot=a[++i];
}
if(!runId||!phaseId||phaseIdx===null||!promptFile||!repoRoot){
err('INVALID_ARGS','Missing required args',{run_id:runId,phase_id:phaseId,phase_index:phaseIdx,prompt_file:promptFile,repo_root:repoRoot});
}
let prompt;
try{prompt=fs.readFileSync(promptFile,'utf8');}catch(e){err('IO_ERROR','Failed to read prompt-file',{error:e.message});}
const plan={
run_id:runId,
phase_id:phaseId,
phase_index:phaseIdx,
repo_root:repoRoot,
prompt:prompt,
next_phase_id:nextPhaseId||null
};
console.log(JSON.stringify(plan,null,2));
}
main();
