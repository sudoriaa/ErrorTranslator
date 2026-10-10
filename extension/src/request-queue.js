export function waitFor(ms,signal) {
  if(signal?.aborted) return Promise.reject(new Error('翻译已停止。'));
  return new Promise((resolve,reject)=>{
    const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,Math.max(0,ms));
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('翻译已停止。'));};
    signal?.addEventListener('abort',abort,{once:true});
  });
}

// Shared concurrency limit across all tabs/providers. Space request starts apart
// while allowing previous requests to finish in parallel. Cancelled work is removed.
export class RequestQueue {
  constructor(concurrency=1) {this.pending=[];this.active=0;this.limit=concurrency;this.startedAt=0;this.timer=null;}
  setConcurrency(value) {
    this.limit=Math.min(20,Math.max(1,Math.round(Number(value)||1)));this.drain();
  }
  run(task,signal,interval=350,concurrency) {
    if(signal?.aborted) return Promise.reject(new Error('翻译已停止。'));
    if(concurrency!==undefined) this.setConcurrency(concurrency);
    return new Promise((resolve,reject)=>{
      const job={task,signal,interval:Math.min(10000,Math.max(0,Number(interval)||0)),resolve,reject};
      job.abort=()=>{const index=this.pending.indexOf(job);if(index>=0){this.pending.splice(index,1);reject(new Error('翻译已停止。'));this.drain();}};
      signal?.addEventListener('abort',job.abort,{once:true});
      this.pending.push(job);this.drain();
    });
  }
  drain() {
    clearTimeout(this.timer);this.timer=null;
    while(this.pending.length && this.active<this.limit) {
      const delay=Math.max(0,this.startedAt+this.pending[0].interval-Date.now());
      if(delay>0) {this.timer=setTimeout(()=>this.drain(),delay);return;}
      const job=this.pending.shift();job.signal?.removeEventListener('abort',job.abort);
      this.active++;this.startedAt=Date.now();
      Promise.resolve().then(()=>{
        if(job.signal?.aborted) throw new Error('翻译已停止。');
        return job.task();
      }).then(job.resolve,job.reject).finally(()=>{this.active--;this.drain();});
    }
  }
}
