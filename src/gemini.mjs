import { HUNTER_SYSTEM, ACTION_SCHEMA } from './hunter.mjs';

export class GeminiPlanner {
  constructor({apiKey,model,maxOutputTokens=1600,fetchImpl=fetch}) {
    if(!apiKey || !/^[a-zA-Z0-9._-]+$/.test(model||'')) throw new Error('GEMINI_CONFIG_REQUIRED');
    this.apiKey=apiKey;this.model=model;this.fetch=fetchImpl;this.maxOutputTokens=Math.min(4096,maxOutputTokens);
    this.usage={calls:0,input_tokens:0,output_tokens:0};
  }
  async next(context,{signal,screenshot}={}) {
    const text=JSON.stringify(context);
    if(text.length>100000) throw new Error('MODEL_CONTEXT_TOO_LARGE');
    const parts=[{text}];
    if(screenshot && screenshot.length<1000000) parts.push({inlineData:{mimeType:'image/jpeg',data:screenshot.toString('base64')}});
    const timeout=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    this.usage.calls++;
    const response=await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':this.apiKey},
      body:JSON.stringify({systemInstruction:{parts:[{text:HUNTER_SYSTEM}]},contents:[{role:'user',parts}],
        generationConfig:{temperature:0.1,maxOutputTokens:this.maxOutputTokens,responseMimeType:'application/json',responseJsonSchema:ACTION_SCHEMA}}),
      signal:combined,redirect:'error'});
    if(!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const body=await response.json();
    this.usage.input_tokens+=body.usageMetadata?.promptTokenCount||0;
    this.usage.output_tokens+=body.usageMetadata?.candidatesTokenCount||0;
    const candidate=body.candidates?.[0];
    if(!candidate||candidate.finishReason!=='STOP') throw new Error('MODEL_INCOMPLETE_OR_BLOCKED');
    const output=candidate.content?.parts?.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
    if(!output || output.length>20000) throw new Error('MODEL_INVALID_OUTPUT');
    try{return JSON.parse(output);}catch{throw new Error('MODEL_INVALID_JSON');}
  }
}
