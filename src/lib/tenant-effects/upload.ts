import { AdminMenuError } from '../data/admin-menus'
import { MAX_FILE_SIZE,convertBufferToWebP } from '../upload'
import { NATIVE_IMAGE_MIMES } from '../data/tenant-effect-uploads'

/** Bound the wire body before multipart parsing; File.size alone is too late
 * to prevent an unbounded request body from occupying server memory. */
export async function nativeMultipartImage(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new AdminMenuError(400,'An image form is required')
  const limit=MAX_FILE_SIZE+65536
  if(Number(request.headers.get('content-length')??0)>limit)throw new AdminMenuError(413,'Image form exceeds 15MB')
  const reader=request.body?.getReader();if(!reader)throw new AdminMenuError(400,'Image form is missing')
  const chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new AdminMenuError(400,'Image upload timed out'))},10000)})
  try{for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.byteLength;if(size>limit)throw new AdminMenuError(413,'Image form exceeds 15MB');chunks.push(next.value)}}finally{clearTimeout(timer);reader.releaseLock()}
  const wire=new Uint8Array(size);let offset=0;for(const chunk of chunks){wire.set(chunk,offset);offset+=chunk.byteLength}
  const form=await new Response(wire,{headers:{'content-type':request.headers.get('content-type')!}}).formData()
  if([...form.keys()].some(key=>key!=='file'&&key!=='type') || form.getAll('file').length!==1 || form.getAll('type').length!==1)throw new AdminMenuError(400,'Invalid image fields')
  const file=form.get('file'),type=form.get('type')
  if(!(file instanceof File) || typeof type!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(type) || !NATIVE_IMAGE_MIMES[file.type] || file.size<1 || file.size>MAX_FILE_SIZE)throw new AdminMenuError(400,'Choose a supported image no larger than 15MB')
  const original=Buffer.from(await file.arrayBuffer()),bytes=await convertBufferToWebP(original,{profile:type==='logo'||type==='favicon'?'logo':type==='banner'||type==='seo'?'wide':'photo'})
  return {type,bytes,original}
}
