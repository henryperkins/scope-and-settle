import {fileURLToPath} from 'node:url';
import {evaluationCli} from './eval-assessments.mjs';
try {
  const result=await evaluationCli(process.argv.slice(2),{appRoot:fileURLToPath(new URL('..',import.meta.url)),root:fileURLToPath(new URL('../..',import.meta.url))});
  console.log(JSON.stringify(result,null,2));
  if(result.mode==='live_provider'&&!result.metricsPass)process.exitCode=1;
} catch(error) {
  console.error('Evaluation refused or interrupted: '+error.message);process.exitCode=1;
}
