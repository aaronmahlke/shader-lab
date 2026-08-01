<script setup lang="ts">
// Demo "stageable" terminal card: fully self-contained, no props, no external
// assets. Rendered off-screen (~640px wide) and captured into the compositor.

type LogLine = {
  ts: string;
  level: "INFO" | "DEBUG";
  msg: string;
};

const preludeLines: LogLine[] = [
  { ts: "14:02:31.114", level: "INFO", msg: "worker-3 accepted job batch (size=128)" },
  { ts: "14:02:31.220", level: "DEBUG", msg: "pg pool checkout 4/20 conns, wait=0ms" },
  { ts: "14:02:31.841", level: "INFO", msg: "checkout.session created cs_9f2ke1" },
];
</script>

<template>
  <div
    class="w-full overflow-hidden rounded-xl border border-zinc-800 bg-[#09090b] font-mono shadow-[0_1px_2px_rgba(0,0,0,0.5),0_20px_50px_-16px_rgba(0,0,0,0.7)]"
  >
    <!-- Title bar -->
    <div
      class="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/70 px-4 py-2.5"
    >
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span class="size-3 rounded-full bg-[#ff5f57]" />
          <span class="size-3 rounded-full bg-[#febc2e]" />
          <span class="size-3 rounded-full bg-[#28c840]" />
        </div>
        <span class="text-[11.5px] text-zinc-500">evlog — checkout-svc.wide.jsonl</span>
      </div>
      <span
        class="flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2 py-0.5 text-[10px] tracking-wide text-zinc-400"
      >
        <span class="stage-live-dot size-1.5 rounded-full bg-emerald-400" />
        streaming
      </span>
    </div>

    <!-- Log body -->
    <div class="overflow-hidden px-4 py-3.5 text-[12px] leading-[1.7] whitespace-pre">
      <!-- Dimmed prelude lines -->
      <div v-for="line in preludeLines" :key="line.ts" class="text-zinc-600">
        <span class="text-zinc-700">{{ line.ts }}</span>
        <span :class="line.level === 'DEBUG' ? 'text-zinc-700' : 'text-zinc-500'">
          {{ " " + line.level.padEnd(5) }}
        </span>
        <span>{{ line.msg }}</span>
      </div>

      <!-- Wide event, pretty-printed -->
      <div class="mt-2 text-zinc-500">
        <span class="text-zinc-700">14:02:32.006</span>
        <span class="text-violet-400"> EVENT</span>
        <span class="text-zinc-600"> checkout.completed {</span>
      </div>
      <div>
        <span class="text-sky-300">  "trace_id"</span><span class="text-zinc-600">: </span><span class="text-emerald-300">"a1b9-44c0-9d2e"</span><span class="text-zinc-600">,</span>
      </div>
      <div>
        <span class="text-sky-300">  "user"</span><span class="text-zinc-600">: </span><span class="text-emerald-300">"cus_58231"</span><span class="text-zinc-600">,</span>
      </div>
      <div>
        <span class="text-sky-300">  "cart_total"</span><span class="text-zinc-600">: </span><span class="text-amber-300">129.90</span><span class="text-zinc-600">,</span>
      </div>
      <div>
        <span class="text-sky-300">  "payment_ms"</span><span class="text-zinc-600">: </span><span class="text-amber-300">312</span><span class="text-zinc-600">,</span>
      </div>
      <div>
        <span class="text-sky-300">  "retries"</span><span class="text-zinc-600">: </span><span class="text-amber-300">0</span>
      </div>
      <div class="text-zinc-600">}</div>

      <!-- Highlighted error line -->
      <div
        class="-mx-4 mt-2 flex items-baseline gap-2 border-l-2 border-red-500 bg-red-500/10 px-4 py-1"
      >
        <span class="text-zinc-600">14:02:32.418</span>
        <span class="font-semibold text-red-400">ERROR</span>
        <span class="text-red-300/90">webhook delivery failed (attempt 2/5): 503 upstream</span>
      </div>

      <!-- Prompt with blinking cursor -->
      <div class="mt-2 flex items-center gap-2">
        <span class="text-emerald-400">❯</span>
        <span class="text-zinc-400">evlog tail --follow --where level=error</span>
        <span class="stage-cursor inline-block h-[15px] w-[7px] translate-y-px bg-zinc-300" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-cursor {
  animation: stage-terminal-blink 1.1s steps(1, end) infinite;
}

@keyframes stage-terminal-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

.stage-live-dot {
  animation: stage-terminal-live 1.6s ease-in-out infinite;
}

@keyframes stage-terminal-live {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
