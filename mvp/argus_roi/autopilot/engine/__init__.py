"""Argus Knowledge Engine.

A small, dependency-light Python module that turns Argus into a knowledge-
augmented LLM proxy. Five files, all under ./engine/:

  providers.py — LiteLLM-style adapter (Gemini, Groq, OpenAI). complete + embed.
  secret.py    — AES-GCM encrypt/decrypt provider api_keys.
  keys.py      — issue / verify Argus-side Bearer API keys.
  ingest.py    — file/Q&A → chunks → embeddings → pgvector rows.
  retrieve.py  — vector ANN + authority/recency rerank.
  chat.py      — RAG-augmented OpenAI-compatible chat completion.

No new heavy deps. We re-use stdlib + the autopilot's existing psql shell-out
pattern in store.py. See docs/KNOWLEDGE_API_SPEC.md for the locked contracts.
"""
