import{parentPort,workerData}from'node:worker_threads';import{retuneCandidate,type Parent}from'./repair-catalog.js';
try{parentPort!.postMessage({ok:true,result:retuneCandidate(workerData as Parent)});}catch(e){parentPort!.postMessage({ok:false,error:e instanceof Error?e.message:String(e)});}
