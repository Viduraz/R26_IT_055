"""Download the lightweight activity video dataset used by the project.

This pulls the compact action-recognition dataset that can be used as the base
for posture classes such as sitting, standing, walking, and lying/sleeping.
"""

import os

import kagglehub


DATASET_ID = "ngoduy/dataset-video-for-human-action-recognition"


def main() -> None:
	print(f"Downloading dataset: {DATASET_ID}")
	dataset_path = kagglehub.dataset_download(DATASET_ID)
	print("Dataset downloaded to:", dataset_path)

	data_root = os.environ.get("DATASET_PATH")
	if data_root:
		print("DATASET_PATH is already set to:", data_root)
	else:
		print(
			"Tip: set DATASET_PATH to the extracted folder if you want to reuse it in other scripts."
		)


if __name__ == "__main__":
	main()