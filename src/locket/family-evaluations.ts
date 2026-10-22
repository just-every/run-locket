import type { Bindings } from '../auth.server'
import records from './family-evaluation-records.json'
import { familyAnalysisPrompt } from './family-analysis-prompt'
import { sha256 } from './model'

// REVIEW-006 owns generating committed live-run records after its complete
// labelled evaluations pass. Deployment flags cannot create or waive a record.
type LiveEvaluation={task:string;providerOrigin:string;model:string;promptSha256:string;live:boolean;status:string;review006Complete:boolean;datasetDigest:string;receipt:string}
export async function familyEvaluationApproved(env:Bindings):Promise<boolean> {
 const transports=[env.AI_BASE_URL||env.AI_API_KEY?'direct':null,env.MODELS_SERVICE||env.MODELS_KEY?'models':null].filter(Boolean)
 if(transports.length!==1||!env.AI_MODEL)return false
 let origin:string
 try{origin=new URL(transports[0]==='models'?env.MODELS_SERVICE!:env.AI_BASE_URL??'https://api.openai.com/v1').origin}catch{return false}
 const promptSha256=await sha256(familyAnalysisPrompt)
 return (records as LiveEvaluation[]).some(record=>record.task==='family-analysis'&&record.providerOrigin===origin&&record.model===env.AI_MODEL&&record.promptSha256===promptSha256&&record.live===true&&record.status==='passed'&&record.review006Complete===true&&/^[a-f0-9]{64}$/.test(record.datasetDigest)&&typeof record.receipt==='string'&&record.receipt.length>0)
}
