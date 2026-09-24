import { createClient } from '@supabase/supabase-js'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      const url = new URL(request.url)
      const q = url.searchParams.get("q")
      if (!q) {
        return Response.json({code:400, msg:"缺少搜索参数 q"}, {status:400, headers:corsHeaders})
      }

      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
      const {data, error} = await supabase
        .from('items')
        .select('id,title,url')
        .textSearch('title', q, {type:'plain'})
        .limit(30)

      if(error) throw error

      return Response.json({code:0, data}, {headers:corsHeaders})
    } catch(e:any) {
      return Response.json({code:500, msg:e.message}, {status:500, headers:corsHeaders})
    }
  }
}

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

