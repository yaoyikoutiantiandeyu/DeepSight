## 1. 配置环境

```powershell
conda create -n your_env_name python=3.11
conda activate your_env_name
pip install torch==2.2.2 torchvision==0.17.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt
```

## 2. 启动服务

```
conda activate your_env_name
cd ../frontend  !!一定要到这个文件夹
uvicorn backend.main:app --host 0.0.0.0 --port 8000
http://127.0.0.1:8000
```

