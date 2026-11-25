<script setup lang="ts">
/**
 * Studio UI kitchen: every component with its states, for review.
 * Public (no login), dev tool.
 */
useHead({ title: "Studio kitchen" });

const sections = [
  { id: "foundations", label: "Foundations" },
  { id: "button", label: "Button" },
  { id: "segmented", label: "Segmented" },
  { id: "value", label: "Value box" },
  { id: "input", label: "Input" },
  { id: "select", label: "Select" },
  { id: "tabs", label: "Tabs" },
  { id: "list", label: "List row" },
  { id: "section", label: "Section" },
  { id: "knob", label: "Knob" },
  { id: "layout", label: "Tiles + layout" },
];

const colors = [
  ["frame", "--s-frame"], ["tile", "--s-tile"], ["band", "--s-band"], ["raise", "--s-raise"],
  ["inset", "--s-inset"], ["edge", "--s-edge"], ["hover", "--s-hover"], ["sel", "--s-sel"],
  ["txt", "--s-txt"], ["dim", "--s-dim"], ["off", "--s-off"], ["bright", "--s-bright"],
  ["accent", "--s-accent"], ["fill", "--s-fill"], ["value", "--s-value"], ["danger", "--s-danger"],
] as const;

// demo state
const mode = ref<"2d" | "3d">("2d");
const monitor = ref("auto");
const wave = ref("sine");
const mb = ref(true);
const solo = ref(false);
const posX = ref(0.12);
const posY = ref(-0.04);
const scale = ref(100);
const opacity = ref(100);
const rot = ref(0);
const blur = ref(4);
const search = ref("");
const blend = ref("normal");
const fps = ref(60);
const parent = ref<string>();
const tab = ref("intro");
const tabs = ref([
  { id: "intro", label: "01 Intro" },
  { id: "deploy", label: "02 Deploy" },
  { id: "logo", label: "03 Logo" },
]);
const sel = ref("intro");
const fxOn = ref(true);
const lfoOn = ref(false);
const open = ref(true);
const rate = ref(0.5);
const depth = ref(0.62);
const phase = ref(0);
const pan = ref(-0.3);

const blendOptions = [
  { value: "normal", label: "Normal" },
  { value: "add", label: "Add" },
  { value: "screen", label: "Screen" },
  { value: "multiply", label: "Multiply" },
  { value: "overlay", label: "Overlay", disabled: true },
];
const fpsOptions = [24, 25, 30, 50, 60].map((v) => ({ value: v, label: `${v} fps` }));
const parentOptions = [
  { value: "none", label: "None" },
  { value: "headline", label: "Headline" },
  { value: "card", label: "Deploy card" },
];
</script>

<template>
  <div data-ui="studio" class="flex h-dvh overflow-hidden bg-[var(--s-frame)]">
    <nav class="flex w-[150px] shrink-0 flex-col gap-[2px] p-[6px]">
      <div class="px-[6px] pt-[4px] pb-[8px] text-[var(--s-bright)]">Studio kitchen</div>
      <a
        v-for="s in sections"
        :key="s.id"
        :href="`#${s.id}`"
        class="flex h-[var(--s-row)] cursor-default items-center rounded-[var(--s-r-ctl)] px-[6px] text-[var(--s-txt)] hover:bg-[var(--s-hover)]"
      >{{ s.label }}</a>
    </nav>

    <main class="min-w-0 flex-1 overflow-y-auto p-[6px] pl-0">
      <div class="flex max-w-[900px] flex-col gap-[var(--s-gap)]">
        <!-- Foundations -->
        <StudioTile id="foundations">
          <StudioSection title="Foundations">
            <div class="flex flex-col gap-[10px]">
              <p class="text-[var(--s-dim)]">One size: 12px, weight 500. Controls 16px (14px small). Rows 19px. Tiles 3px corners, controls 2px. 6px gaps between tiles.</p>
              <div class="grid grid-cols-4 gap-[6px]">
                <div v-for="[name, v] in colors" :key="name" class="flex items-center gap-[6px]">
                  <span class="size-[16px] shrink-0 rounded-[2px] shadow-[inset_0_0_0_1px_#ffffff14]" :style="{ background: `var(${v})` }" />
                  <span>{{ name }}</span>
                  <span class="text-[var(--s-dim)]">{{ v }}</span>
                </div>
              </div>
              <div class="flex items-baseline gap-[16px]">
                <span class="text-[var(--s-bright)]">Bright text</span>
                <span>Default text</span>
                <span class="text-[var(--s-dim)]">Dim text</span>
                <span class="text-[var(--s-off)]">Disabled</span>
                <span class="s-num text-[var(--s-value)]">0.12, −0.04</span>
              </div>
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Button -->
        <StudioTile id="button">
          <StudioSection title="Button">
            <div class="flex flex-col gap-[8px]">
              <div class="flex flex-wrap items-center gap-[4px]">
                <span class="w-[70px] text-[var(--s-dim)]">Inset</span>
                <StudioButton>Fit</StudioButton>
                <StudioButton :active="solo" @click="solo = !solo">S</StudioButton>
                <StudioButton active>Export</StudioButton>
                <StudioButton disabled>Disabled</StudioButton>
                <StudioButton square aria-label="Add"><d-icon-plus /></StudioButton>
                <StudioButton aria-label="Snap"><d-icon-magnet /> Snap</StudioButton>
              </div>
              <div class="flex flex-wrap items-center gap-[4px]">
                <span class="w-[70px] text-[var(--s-dim)]">Small</span>
                <StudioButton size="sm">Fit</StudioButton>
                <StudioButton size="sm" active>S</StudioButton>
                <StudioButton size="sm" square aria-label="Add"><d-icon-plus /></StudioButton>
              </div>
              <div class="flex flex-wrap items-center gap-[4px] rounded-[var(--s-r)] bg-[var(--s-frame)] p-[6px]">
                <span class="w-[64px] text-[var(--s-dim)]">Tile</span>
                <StudioButton variant="tile">Atlasflow launch</StudioButton>
                <StudioButton variant="tile" square aria-label="Back"><d-icon-arrow-left /></StudioButton>
                <StudioButton variant="tile" aria-label="Preview"><d-icon-play-progress /></StudioButton>
                <StudioButton variant="tile" active>Export</StudioButton>
              </div>
              <div class="flex flex-wrap items-center gap-[4px]">
                <span class="w-[70px] text-[var(--s-dim)]">Ghost</span>
                <StudioButton variant="ghost" square aria-label="Visible"><d-icon-eye /></StudioButton>
                <StudioButton variant="ghost" square aria-label="Lock"><d-icon-lock-open /></StudioButton>
                <StudioButton variant="ghost" square aria-label="Delete"><d-icon-trash /></StudioButton>
                <StudioButton variant="ghost">Reset</StudioButton>
              </div>
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Segmented -->
        <StudioTile id="segmented">
          <StudioSection title="Segmented">
            <div class="flex flex-wrap items-center gap-[12px]">
              <StudioSegmented v-model="mode" :options="[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]" />
              <StudioSegmented v-model="monitor" :options="[{ value: 'in', label: 'In' }, { value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }]" />
              <StudioSegmented v-model="mb" :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]" />
              <StudioSegmented v-model="wave" size="sm" :options="[{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'noise', label: 'Noise', disabled: true }]" />
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Value -->
        <StudioTile id="value">
          <StudioSection title="Value box">
            <div class="flex flex-col gap-[8px]">
              <p class="text-[var(--s-dim)]">Drag up/down or left/right. Shift = fine. Click to type. Double-click resets. With min/max it shows a fill bar.</p>
              <div class="grid grid-cols-4 gap-[6px]">
                <StudioField label="Scale"><StudioValue v-model="scale" :min="0" :max="400" :step="1" :precision="0" unit="%" :default-value="100" /></StudioField>
                <StudioField label="Opacity"><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" :default-value="100" /></StudioField>
                <StudioField label="Blur"><StudioValue v-model="blur" :min="0" :max="20" :step="0.1" :precision="1" :default-value="0" /></StudioField>
                <StudioField label="Rotation"><StudioValue v-model="rot" :step="1" :precision="0" unit="°" :default-value="0" /></StudioField>
              </div>
              <div class="grid grid-cols-2 gap-[4px]" style="max-width:240px">
                <StudioValue v-model="posX" label="X" :step="0.01" :default-value="0" />
                <StudioValue v-model="posY" label="Y" :step="0.01" :default-value="0" />
              </div>
              <div class="flex flex-col gap-[3px]" style="max-width:320px">
                <StudioField label="Opacity" inline><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" /></StudioField>
                <StudioField label="Position X" inline><StudioValue v-model="posX" :step="0.01" align="left" /></StudioField>
              </div>
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Input -->
        <StudioTile id="input">
          <StudioSection title="Input">
            <div class="flex max-w-[320px] flex-col gap-[6px]">
              <StudioInput v-model="search" placeholder="Search (⌘F)"><template #leading><d-icon-magnifier /></template></StudioInput>
              <StudioInput placeholder="Layer name" />
              <StudioInput size="sm" placeholder="Small" />
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Select -->
        <StudioTile id="select">
          <StudioSection title="Select">
            <div class="flex flex-wrap items-end gap-[8px]">
              <StudioField label="Blend" class="w-[120px]"><StudioSelect v-model="blend" :options="blendOptions" /></StudioField>
              <StudioField label="Parent" class="w-[120px]"><StudioSelect v-model="parent" :options="parentOptions" placeholder="None" /></StudioField>
              <StudioField label="Small" class="w-[100px]"><StudioSelect v-model="fps" size="sm" :options="fpsOptions" /></StudioField>
              <div class="rounded-[var(--s-r)] bg-[var(--s-frame)] p-[6px]">
                <StudioSelect v-model="fps" variant="tile" :options="fpsOptions" class="w-[80px]" />
              </div>
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Tabs -->
        <StudioTile id="tabs">
          <StudioSection title="Tabs">
            <div class="rounded-[var(--s-r)] bg-[var(--s-frame)] p-[6px]">
              <StudioTabs
                v-model="tab"
                :tabs="tabs"
                closable
                @close="(id) => (tabs = tabs.filter((t) => t.id !== id))"
                @add="tabs.push({ id: `c${tabs.length}`, label: `Comp ${tabs.length + 1}` })"
              />
            </div>
          </StudioSection>
        </StudioTile>

        <!-- List -->
        <StudioTile id="list">
          <StudioSection title="List row">
            <div class="-mx-[6px] max-w-[300px]">
              <StudioListRow :selected="sel === 'intro'" @click="sel = 'intro'"><template #icon><d-icon-layers /></template>01 Intro<template #meta>comp</template></StudioListRow>
              <StudioListRow :selected="sel === 'deploy'" @click="sel = 'deploy'"><template #icon><d-icon-layers /></template>02 Deploy<template #meta>comp</template></StudioListRow>
              <StudioListRow :selected="sel === 'card'" @click="sel = 'card'"><template #icon><d-icon-code /></template>DeployCard<template #meta>vue</template></StudioListRow>
              <StudioListRow :selected="sel === 'logo'" :depth="1" @click="sel = 'logo'"><template #icon><d-icon-image /></template>logo.svg<template #meta>svg</template></StudioListRow>
              <StudioListRow :selected="sel === 'track'" :depth="1" @click="sel = 'track'"><template #icon><d-icon-waveform-lines /></template>track.wav<template #meta>wav</template></StudioListRow>
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Section -->
        <div id="section" class="grid grid-cols-2 gap-[var(--s-gap)]">
          <StudioTile>
            <StudioSection v-model:enabled="fxOn" title="Blur">
              <template #actions><StudioButton variant="ghost" size="sm" square aria-label="More"><d-icon-dots /></StudioButton></template>
              <div class="grid grid-cols-2 gap-[5px_6px]">
                <StudioField label="Amount"><StudioValue v-model="blur" :min="0" :max="20" :step="0.1" :precision="1" /></StudioField>
                <StudioField label="Quality"><StudioSegmented v-model="wave" :options="[{ value: 'sine', label: 'Low' }, { value: 'saw', label: 'High' }]" /></StudioField>
              </div>
            </StudioSection>
          </StudioTile>
          <StudioTile>
            <StudioSection v-model:enabled="lfoOn" v-model:open="open" title="LFO 1" collapsible>
              <template #actions><StudioSegmented v-model="wave" size="sm" :options="[{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }]" /></template>
              <div class="flex gap-[6px]">
                <StudioKnob v-model="rate" label="Rate" :min="0" :max="4" unit="Hz" />
                <StudioKnob v-model="depth" label="Depth" :min="0" :max="1" />
              </div>
            </StudioSection>
          </StudioTile>
        </div>

        <!-- Knob -->
        <StudioTile id="knob">
          <StudioSection title="Knob">
            <div class="flex gap-[8px]">
              <StudioKnob v-model="rate" label="Rate" :min="0" :max="4" unit="Hz" :default-value="1" />
              <StudioKnob v-model="depth" label="Depth" :min="0" :max="1" :default-value="0.5" />
              <StudioKnob v-model="phase" label="Phase" :min="0" :max="360" :step="1" :precision="0" unit="°" />
              <StudioKnob v-model="pan" label="Pan" :min="-1" :max="1" bipolar :default-value="0" />
            </div>
          </StudioSection>
        </StudioTile>

        <!-- Layout -->
        <div id="layout" class="flex flex-col gap-[var(--s-gap)]">
          <div class="text-[var(--s-dim)] px-[2px]">Tiles + layout: grey tiles on the frame, 6px gaps; areas inside a tile split by 2px lines.</div>
          <div class="grid h-[220px] grid-cols-[240px_1fr_200px] gap-[var(--s-gap)]">
            <StudioTile split="col" class="!grid-cols-[80px_1fr] !grid-flow-row">
              <div class="pt-[6px]">
                <StudioListRow selected>All</StudioListRow>
                <StudioListRow>Comps</StudioListRow>
                <StudioListRow>Assets</StudioListRow>
              </div>
              <div class="pt-[6px]">
                <StudioListRow><template #icon><d-icon-layers /></template>01 Intro</StudioListRow>
                <StudioListRow><template #icon><d-icon-layers /></template>02 Deploy</StudioListRow>
              </div>
            </StudioTile>
            <StudioTile class="grid place-items-center text-[var(--s-dim)]">Canvas</StudioTile>
            <StudioTile class="grid place-items-center text-[var(--s-dim)]">Inspector</StudioTile>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
