FROM amazon/aws-cli

# Install dependencies
RUN yum install -y net-tools jq nmap-ncat tar && \
    yum clean all

# Download and install rcon-cli
RUN curl -L https://github.com/gorcon/rcon-cli/releases/download/v0.10.3/rcon-0.10.3-amd64_linux.tar.gz -o rcon-cli.tar.gz
RUN tar -xzvf rcon-cli.tar.gz
RUN mv rcon-0.10.3-amd64_linux/rcon /usr/local/bin/ && rm rcon-cli.tar.gz && rm -rf rcon-0.10.3-amd64_linux

COPY ./watchdog.sh .

ENTRYPOINT ["./watchdog.sh"]