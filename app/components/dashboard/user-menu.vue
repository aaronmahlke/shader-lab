<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import { ArrowRightStartOnRectangleIcon } from "@heroicons/vue/16/solid";

const { user, clear } = useUserSession();

async function logout() {
  await clear();
  navigateTo("/login");
}
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button class="flex size-8 items-center justify-center overflow-hidden rounded-full bg-surface-1 transition-opacity duration-150 hover:opacity-80">
        <img
          v-if="user?.avatarUrl"
          :src="user.avatarUrl"
          :alt="user.username"
          class="size-full object-cover"
        />
        <span v-else class="text-copy-sm text-tertiary">
          {{ user?.username?.charAt(0)?.toUpperCase() ?? '?' }}
        </span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="8"
        :collision-padding="12"
        class="z-50 w-56 rounded-xl border border-edge bg-base-1 p-1 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
      >
        <div class="px-2.5 py-2">
          <div class="text-copy-sm text-primary">{{ user?.username }}</div>
          <div class="text-copy-sm text-tertiary">{{ user?.email }}</div>
        </div>
        <div class="my-1 h-px bg-surface-1" />
        <button
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-copy-sm text-secondary transition-colors duration-150 hover:bg-surface-1 hover:text-primary"
          @click="logout"
        >
          <ArrowRightStartOnRectangleIcon class="size-4" />
          Log out
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
