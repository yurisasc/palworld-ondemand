FROM amazon/aws-cli

# Install dependencies
RUN yum install -y net-tools jq nmap-ncat tar && \
    yum clean all

# Download and install rcon-cli
RUN curl -L https://github.com/gorcon/rcon-cli/releases/download/v0.10.3/rcon-0.10.3-amd64_linux.tar.gz -o rcon-cli.tar.gz && \
    tar -xzvf rcon-cli.tar.gz && \
    mv rcon /usr/local/bin/ && \
    rm rcon-cli.tar.gz

COPY ./watchdog.sh .

ENTRYPOINT ["./watchdog.sh"]