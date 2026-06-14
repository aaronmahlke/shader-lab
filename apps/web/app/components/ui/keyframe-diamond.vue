<script setup lang="ts">
import { useId } from "vue";

defineOptions({ inheritAttrs: false });

type Props = {
  selected?: boolean;
  atPlayhead?: boolean;
};

const { selected = false, atPlayhead = false } = defineProps<Props>();

const maskId = useId();

const OUTER_RING =
  "M8.23242 3.06055C9.20869 2.08444 10.7913 2.08444 11.7676 3.06055L16.9395 8.23242C17.9156 9.20869 17.9156 10.7913 16.9395 11.7676L11.7676 16.9395C10.7913 17.9156 9.20869 17.9156 8.23242 16.9395L3.06055 11.7676C2.08444 10.7913 2.08444 9.20869 3.06055 8.23242L8.23242 3.06055Z";

const INNER_MASK =
  "M9.29289 3.70711C9.68342 3.31658 10.3166 3.31658 10.7071 3.70711L16.2929 9.29289C16.6834 9.68342 16.6834 10.3166 16.2929 10.7071L10.7071 16.2929C10.3166 16.6834 9.68342 16.6834 9.29289 16.2929L3.70711 10.7071C3.31658 10.3166 3.31658 9.68342 3.70711 9.29289L9.29289 3.70711Z";

const LEFT_HALF = "M10 3L3 10L10 17V3Z";
const RIGHT_HALF = "M10 3L17 10L10 17V3Z";

const CX = 10;
const CY = 10;
/** Compensate for 20×20 artboard padding vs old 16×16 diamond. */
const CONTENT_SCALE = 1.2;
const contentTransform = `translate(${CX} ${CY}) scale(${CONTENT_SCALE}) translate(-${CX} -${CY})`;
/** Playhead ring only — larger = more offset gap before the inner fill. */
const RING_OUTLINE_SCALE = 1.16;
const ringOutlineTransform = `translate(${CX} ${CY}) scale(${RING_OUTLINE_SCALE}) translate(-${CX} -${CY})`;

const showOutlineRing = computed(() => selected);
const filledAtPlayhead = computed(() => atPlayhead);
</script>

<template>
  <svg
    v-bind="$attrs"
    viewBox="0 0 20 20"
    fill="none"
    overflow="visible"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <g :transform="contentTransform">
      <g v-if="showOutlineRing" :transform="ringOutlineTransform">
        <path
          :d="OUTER_RING"
          class="stroke-accent"
        />
      </g>

      <defs v-if="showOutlineRing">
        <mask
          :id="maskId"
          style="mask-type: alpha"
          maskUnits="userSpaceOnUse"
          x="3"
          y="3"
          width="14"
          height="14"
        >
          <path :d="INNER_MASK" fill="white" />
        </mask>
      </defs>

      <g :mask="showOutlineRing ? `url(#${maskId})` : undefined">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          :d="LEFT_HALF"
          :class="filledAtPlayhead ? 'fill-accent' : 'fill-white'"
        />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          :d="RIGHT_HALF"
          :class="filledAtPlayhead ? 'fill-accent opacity-50' : 'fill-white opacity-50'"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.stroke-accent {
  stroke: var(--color-accent);
  stroke-width: 3;
}
</style>
