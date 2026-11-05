import { NextResponse } from 'next/server'
import { AdminMenuError } from '../data/admin-menus'
import { verifyNativeTenantWork } from './queue'
import { dispatchNativeCrmEffect } from './crm'

export async function nativeCrmWorkerHttp(request:Request) {
  try{
    const id=await verifyNativeTenantWork(request,'crm'),result=await dispatchNativeCrmEffect(id)
    return NextResponse.json(result,{status:result.status==='reconcile'?489:200,headers:{'Cache-Control':'private, no-store',...(result.status==='reconcile'?{'Upstash-NonRetryable-Error':'true'}:{})}})
  }catch(error){
    const status=error instanceof AdminMenuError && error.status<500?error.status:503
    return NextResponse.json({error:status<500&&error instanceof AdminMenuError?error.message:'Native CRM worker is unavailable'},
      {status,headers:{'Cache-Control':'private, no-store','Upstash-NonRetryable-Error':'true'}})
  }
}
