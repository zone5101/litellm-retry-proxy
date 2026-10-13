function OaiRendererScopeProbe(){
  let scope=Di(q);
  rPc.useEffect(()=>{
    const api=window.chatGPTPCBridge;
    if(!api)return;
    let service;
    try{service=scope.get(yD)}catch{return}
    if(!service||typeof service.startCompletionStream!==`function`)return;
    document.documentElement.dataset.oaiRendererBridge=`ready`;
    let active=null;
    function emit(state,kind,data){api.emit({request_id:state.id,kind,data})}
    function finish(state,kind,data){
      if(active!==state||state.finished)return;
      state.finished=true;
      service.startCompletionStream=state.original;
      emit(state,kind,data);
      active=null;
    }
    function capture(state,update){
      if(active!==state||update?.type!==`message`)return;
      const m=update.message;
      if(m?.author?.role!==`assistant`||(m.channel!=null&&m.channel!==`final`))return;
      if(m.recipient!=null&&m.recipient!==`all`){state.abort.abort();finish(state,`error`,{code:`tool_call_unverified`});return}
      const parts=m.content?.parts;
      if(!Array.isArray(parts)||!parts.every(x=>typeof x===`string`))return;
      const value=parts.join(``);
      if(value){state.sawText=true;emit(state,`snapshot`,{message_id:m.id??null,text:value,status:m.status??null,end_turn:m.end_turn??null})}
    }
    const unsubscribe=api.onRequest(async request=>{
      if(request?.operation===`cancel`){
        if(active?.id===request.request_id){active.abort.abort();finish(active,`error`,{code:`cancelled`})}
        return;
      }
      if(request?.operation!==`complete`||typeof request.request_id!==`string`||typeof request.prompt!==`string`)return;
      if(active){api.emit({request_id:request.request_id,kind:`error`,data:{code:`busy`}});return}
      const state={id:request.request_id,original:service.startCompletionStream,abort:new AbortController,finished:false,sawText:false};
      active=state;
      service.startCompletionStream=function(options){
        if(active!==state)return state.original.call(this,options);
        const wrapped={...options,
          onResponse:response=>{options.onResponse?.(response);emit(state,`response`,{status:response?.status??null})},
          onDecodedEvent:event=>{options.onDecodedEvent?.(event);capture(state,event?.update)},
          onUpdate:update=>{options.onUpdate?.(update);capture(state,update)},
          onComplete:value=>{options.onComplete?.(value);emit(state,`transport_complete`,{reason:value?.reason??null})},
          onError:value=>{emit(state,`diagnostic`,{stage:`onError`,status:value?.status??value?.responseStatus??null,errorKind:value?.errorKind??null});options.onError?.(value);finish(state,`error`,{code:`native_stream_error`})},
          onPrematureTermination:()=>{options.onPrematureTermination?.();finish(state,`error`,{code:`premature_termination`})}
        };
        return state.original.call(this,wrapped);
      };
      try{
        const submitted=await Jwi(scope,{prompt:request.prompt,model:`auto`,startupSignal:state.abort.signal,onCompletion:outcome=>{
          emit(state,`diagnostic`,{stage:`onCompletion`,outcome:String(outcome)});
          if(outcome===`completed`&&state.sawText)finish(state,`terminal`,{finish_reason:`stop`});
          else finish(state,`error`,{code:`native_outcome_${String(outcome)}`});
        }});
        if(active===state)emit(state,`submitted`,{conversation_id:submitted?.conversationId??null,stream_request_id:submitted?.streamRequestId??null});
      }catch(error){finish(state,`error`,{code:error?.name??`dispatch_error`})}
    });
    api.ready();
    return()=>{unsubscribe();if(active){active.abort.abort();service.startCompletionStream=active.original;active=null}}
  },[scope]);
  return null
}
