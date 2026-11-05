import { NextResponse } from 'next/server'
import { verifyNativeTenantWork } from '@/lib/tenant-effects/queue'
import { executeNativeImageJob } from '@/lib/tenant-effects/execute'
import { AdminMenuError } from '@/lib/data/admin-menus'

export const runtime='nodejs'
export const maxDuration=300
export async function POST(request:Request) {
  try{
    const id=await verifyNativeTenantWork(request,'ai'),result=await executeNativeImageJob(id)
    return NextResponse.json(result,{status:result.status==='reconcile'?489:200,headers:{'Cache-Control':'private, no-store',...(result.status==='reconcile'?{'Upstash-NonRetryable-Error':'true'}:{})}})
  }catch(error){
    const status=error instanceof AdminMenuError&&error.status<500?error.status:503
    return NextResponse.json({error:status<500&&error instanceof AdminMenuError?error.message:'Native image worker is unavailable'},
      {status,headers:{'Cache-Control':'private, no-store',...(status<500?{'Upstash-NonRetryable-Error':'true'}:{})}})
  }
}
