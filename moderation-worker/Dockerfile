FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/opt/huggingface
ENV HF_HUB_OFFLINE=0

COPY requirements.txt .

# Install the CPU wheel first: the default Linux PyPI Torch wheel pulls CUDA.
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && pip check

COPY app ./app
COPY scripts ./scripts

RUN python -m scripts.download_model

ENV HF_HUB_OFFLINE=1

CMD ["python", "-m", "app.main"]
