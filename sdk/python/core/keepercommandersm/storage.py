import logging
import os
import json

# An Interface for different storage types
import errno
from json import JSONDecodeError

from keepercommandersm.configkeys import ConfigKeys
from keepercommandersm.utils import ENCODING


class KeyValueStorage:
    """ Interface for the key value storage"""

    def read_storage(self):
        pass

    def save_storage(self, updated_config):
        pass

    def get(self, key: ConfigKeys):
        pass

    def set(self, key: ConfigKeys, value):
        pass

    def delete(self, key: ConfigKeys):
        pass

    def delete_all(self):
        pass

    def contains(self, key: ConfigKeys):
        pass


class FileKeyValueStorage(KeyValueStorage):
    """ File based implementation of the key value storage"""

    default_config_file_location = "client-config.json"

    def __init__(self, config_file_location=default_config_file_location):
        self.default_config_file_location = config_file_location

    def read_storage(self):

        self.create_config_file_if_missing()

        try:
            with open(self.default_config_file_location, "r", encoding=ENCODING) as config_file:
                try:

                    config = json.load(config_file)
                except JSONDecodeError:
                    logging.debug("Looks like config file is empty.")

                    config = {}
                    self.save_storage(config)

        except IOError:
            raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), self.default_config_file_location)

        return config

    def save_storage(self, updated_config):

        self.create_config_file_if_missing()

        with open(self.default_config_file_location, "w") as write_file:
            json.dump(updated_config, write_file, indent=4, sort_keys=True)

    def get(self, key: ConfigKeys):
        config = self.read_storage()

        return config.get(key.value)

    def set(self, key: ConfigKeys, value):
        config = self.read_storage()
        config[key.value] = value

        self.save_storage(config)

        return config

    def delete(self, key: ConfigKeys):
        config = self.read_storage()

        kv = key.value

        if kv in config:
            del config[kv]
            logging.debug("Removed key %s" % kv)
        else:
            logging.warning("No key %s was found in config" % kv)

        self.save_storage(config)

        return config

    def delete_all(self):
        config = self.read_storage()
        config.clear()

        self.save_storage(config)

        return config

    def contains(self, key: ConfigKeys):
        config = self.read_storage()

        return key.value in config

    def create_config_file_if_missing(self):
        if not os.path.exists(self.default_config_file_location):
            # write json values to file: https://realpython.com/python-json/
            f = open(self.default_config_file_location, "w+")
            f.close()


class InMemoryKeyValueStorage(KeyValueStorage):
    """ File based implementation of the key value storage"""

    def read_storage(self):
        pass

    def save_storage(self):
        pass

    def get_value(self, key):
        pass

    def set_value(self, key, value):
        pass