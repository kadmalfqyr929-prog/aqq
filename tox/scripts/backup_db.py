from check_database import create_daily_backup


def main():
    target = create_daily_backup()
    print(target)


if __name__ == "__main__":
    main()
