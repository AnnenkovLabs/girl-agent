/**
 * Migration 0113: сгенерировать communication.md если отсутствует.
 *
 * Профили, созданные до введения communication.md, не имеют этого файла.
 * Миграция использует LLM юзера для генерации communication.md на основе persona.md.
 * Если LLM недоступен — пропускает без ошибки.
 */

import type { Migration, MigrationContext } from "./index.js";
import { readMd, writeMd } from "../storage/md.js";

export const migration0113: Migration = {
  id: "0113-ensure-communication-md",
  description: "Сгенерировать communication.md через AI если отсутствует",
  needsLLM: true,

  async migrate(ctx: MigrationContext) {
    const { config, llm, log } = ctx;
    const existing = await readMd(config.slug, "communication.md");
    if (existing.trim()) return config;

    if (!llm) {
      log("communication.md отсутствует, но LLM недоступен — пропуск");
      return config;
    }

    const persona = await readMd(config.slug, "persona.md");
    if (!persona.trim()) {
      log("persona.md тоже отсутствует — пропуск генерации communication.md");
      return config;
    }

    log("генерируем communication.md через AI...");
    const prompt = `На основе persona.md ниже сгенерируй communication.md — предпочтения в общении ${config.name}, ${config.age} лет. Структура:

# Предпочтения в общении
## Когда пишет (активные часы, частота)
## Стиль сообщений (длина, эмодзи, стикеры, войсы)
## Что бесит в переписке (конкретные триггеры)
## Темы которые заходят / не заходят
## Реакция на голосовые / видео / фото

Пиши от третьего лица, кратко, без эмодзи. Не более 250 слов.

persona.md:
${persona}`;

    const response = await llm.chat([
      { role: "system", content: "Ты генерируешь файлы профиля персонажа для ролевой игры." },
      { role: "user", content: prompt }
    ]);

    if (response?.trim()) {
      await writeMd(config.slug, "communication.md", response);
      log("communication.md сгенерирован");
    }

    return config;
  }
};
