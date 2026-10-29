# Build and publish this image once, then use its immutable digest in Admin templates.
FROM node:24-bookworm-slim AS hub-proxy
RUN npm install --global configurable-http-proxy@5.1.0
FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04 AS llama
ARG LLAMA_CPP_REF=b5046
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential libcurl4-openssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${LLAMA_CPP_REF} https://github.com/ggml-org/llama.cpp.git /src/llama
RUN cmake -S /src/llama -B /src/llama/build -DGGML_CUDA=ON -DGGML_NATIVE=OFF -DCMAKE_CUDA_ARCHITECTURES="80;86;89;90" -DLLAMA_CURL=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=ON -DBUILD_SHARED_LIBS=OFF && cmake --build /src/llama/build --target llama-server -j 4

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
ENV ARENA_MODEL_REVISION=1dc8cf9ffa5dd333057ea1b09ccf4772d8726dec
RUN apt-get update && apt-get install -y --no-install-recommends python3.10 python3.10-dev python3.10-venv python3-pip build-essential libcurl4 libgomp1 libgl1 libglib2.0-0 ffmpeg curl ca-certificates tini procps && rm -rf /var/lib/apt/lists/*
RUN python3.10 -m venv /opt/arena/venv
ENV PATH="/opt/arena/venv/bin:${PATH}"
RUN pip install pip==25.0.1 && pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
COPY requirements.txt /opt/arena/requirements.txt
COPY requirements-hub.txt /opt/arena/requirements-hub.txt
RUN pip install -r /opt/arena/requirements.txt && python -m ipykernel install --sys-prefix --name pytorch --display-name "Python 3.10 (PyTorch)"
RUN python3.10 -m venv /opt/arena/hub-venv && /opt/arena/hub-venv/bin/pip install -r /opt/arena/requirements-hub.txt
COPY --from=hub-proxy /usr/local/bin/node /usr/local/bin/node
COPY --from=hub-proxy /usr/local/lib/node_modules/configurable-http-proxy /usr/local/lib/node_modules/configurable-http-proxy
RUN ln -s /usr/local/lib/node_modules/configurable-http-proxy/bin/configurable-http-proxy /usr/local/bin/configurable-http-proxy
# Separate CUDA dependencies prevent TensorFlow/PyTorch wheel conflicts.
RUN python3.10 -m venv /opt/arena/tensorflow && /opt/arena/tensorflow/bin/pip install "tensorflow[and-cuda]==2.17.1" ipykernel==6.29.5 numpy==1.26.4 pandas==2.2.3 matplotlib==3.9.4 scikit-learn==1.6.1 && /opt/arena/tensorflow/bin/python -m ipykernel install --prefix /opt/arena/venv --name tensorflow --display-name "Python 3.10 (TensorFlow)"
COPY --from=llama /src/llama/build/bin/llama-server /opt/arena/llama-server
RUN python -c "import torch, torchvision, transformers, spacy, nltk, gensim, fasttext, cv2, skimage, xgboost, catboost; assert torch.__version__.startswith('2.8.0'); assert transformers.__version__ == '4.57.1'" && /opt/arena/tensorflow/bin/python -c "import tensorflow as tf; assert tf.__version__ == '2.17.1'"
COPY agent.py start.py hub_runtime.py hub_auth.py hub_config.py /opt/arena/
EXPOSE 8888 8000
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "python", "/opt/arena/start.py"]
