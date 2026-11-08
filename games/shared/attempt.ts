// Browser-only transport is supplied by each client. The identifier is also readable by evals.
export type PlayerSource = 'human' | 'engine' | 'qa';
export type EndType = 'win' | 'loss' | 'quit';
export interface AttemptEvent { session_id:string; type:'attempt'|EndType; moves_used?:number; time_seconds?:number }
export function sourceFor(search:string,automated=false):PlayerSource {
  return new URLSearchParams(search).get('qa')==='1' ? 'qa' : automated ? 'engine' : 'human';
}
export function attemptId(source:PlayerSource):string { return `${source}:v1:${crypto.randomUUID()}`; }
/** One first-action attempt and one terminal event. Automation keeps its identity on takeover. */
export class PlayerAttempt {
  private id:string|null=null;
  private ended=false;
  constructor(private readonly emit:(event:AttemptEvent,beacon?:boolean)=>void) {}
  start(source:PlayerSource):void {
    if(this.id || this.ended)return;
    this.id=attemptId(source);this.emit({session_id:this.id,type:'attempt'});
  }
  end(type:EndType,metrics:{moves_used?:number;time_seconds?:number}={},beacon=false):void {
    if(!this.id || this.ended)return;
    this.ended=true;this.emit({session_id:this.id,type,...metrics},beacon);
  }
  get inProgress():boolean { return this.id!==null&&!this.ended; }
}
