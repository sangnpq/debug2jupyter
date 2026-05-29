import pandas as pd
from dask import delayed
from dask.distributed import Client


@delayed
def load_data(path):
    return pd.read_csv(path)


@delayed
def filter_age(df, min_age):
    return df[df["age"] >= min_age]


@delayed
def add_age_category(df):
    df = df.copy()
    df["category"] = df["age"].apply(
        lambda a: "senior" if a >= 35 else "junior"
    )
    return df


if __name__ == "__main__":
    client = Client(n_workers=2, threads_per_worker=1)

    raw = load_data("data.csv")
    filtered = filter_age(raw, 25)
    enriched = add_age_category(filtered)

    result = enriched.compute()
    print(result)

    client.close()
